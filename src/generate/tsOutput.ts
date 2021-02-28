/*
Zapatos: https://jawj.github.io/zapatos/
Copyright (C) 2020 George MacKerron
Released under the MIT licence: see LICENCE file
*/

import * as pg from 'pg';

import { enumDataForSchema, enumTypesForEnumData } from './enums';
import { Relation, relationsInSchema, definitionForRelationInSchema, crossTableTypesForTables } from './tables';
import { header } from './header';
import type { CompleteConfig } from './config';
import type { SchemaVersionCanary } from "../db/canary";


export interface CustomTypes {
  [name: string]: string;  // any, or TS type for domain's base type
}

const
  canaryVersion: SchemaVersionCanary['version'] = 101,
  versionCanary = `
// got a type error on schemaVersionCanary below? update by running \`npx zapatos\`
export interface schemaVersionCanary extends db.SchemaVersionCanary { version: ${canaryVersion} }
`;

const declareModule = (module: string, declarations: string) => `
declare module '${module}' {
${declarations.replace(/^(?=[ \t]*\S)/gm, '  ')}
}
`;

const customTypeHeader = `/*
** Please edit this file as needed **
It's been generated by Zapatos as a custom type definition placeholder, and won't be overwritten
*/
`;

const sourceFilesForCustomTypes = (customTypes: CustomTypes) =>
  Object.fromEntries(Object.entries(customTypes)
    .map(([name, baseType]) => [
      name,
      customTypeHeader + declareModule('zapatos/custom',
        (baseType === 'db.JSONValue' ? `import type * as db from 'zapatos/db';\n` : ``) +
        `export type ${name} = ${baseType};  // replace with your custom type or interface as desired`
      )
    ]));

export const tsForConfig = async (config: CompleteConfig) => {
  const
    { schemas, db } = config,
    pool = new pg.Pool(db),
    customTypes = {},
    schemaData = (await Promise.all(
      Object.keys(schemas).map(async schema => {
        const
          rules = schemas[schema],
          tables = rules.exclude === '*' ? [] :  // exclude takes precedence
            (await relationsInSchema(schema, pool))
              .filter(rel => rules.include === '*' || rules.include.indexOf(rel.name) >= 0)
              .filter(rel => rules.exclude.indexOf(rel.name) < 0),
          enums = await enumDataForSchema(schema, pool),
          tableDefs = await Promise.all(tables.map(async table =>
            definitionForRelationInSchema(table, schema, enums, customTypes, config, pool))),
          schemaDef = `\n/* === schema: ${schema} === */\n` +
            `\n/* --- enums --- */\n` +
            enumTypesForEnumData(enums) +
            `\n\n/* --- tables --- */\n` +
            tableDefs.sort().join('\n');

        return { schemaDef, tables };
      }))
    ),
    schemaDefs = schemaData.map(r => r.schemaDef).sort(),
    schemaTables = schemaData.map(r => r.tables),
    allTables = ([] as Relation[]).concat(...schemaTables).sort((a, b) => a.name.localeCompare(b.name)),
    hasCustomTypes = Object.keys(customTypes).length > 0,
    ts = header() + declareModule('zapatos/schema',
      `\nimport type * as db from 'zapatos/db';\n` +
      (hasCustomTypes ? `import type * as c from 'zapatos/custom';\n` : ``) +
      versionCanary +
      schemaDefs.join('\n\n') +
      `\n\n/* === cross-table types === */\n` +
      crossTableTypesForTables(allTables)
    ),
    customTypeSourceFiles = sourceFilesForCustomTypes(customTypes);

  await pool.end();
  return { ts, customTypeSourceFiles };
};
