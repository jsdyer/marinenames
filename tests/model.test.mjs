import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {API, queryInput, searchPath, recordsFromResponse, lineage, acceptedName, safeURL, normalizeConfig, validateCapture, csv, createClient} from '../web/model.mjs';
const config=JSON.parse(readFileSync(new URL('../web/config.json',import.meta.url)));
const manifest=JSON.parse(readFileSync(new URL('../web/data/index.json',import.meta.url)));
const sample=JSON.parse(readFileSync(new URL('../web/'+manifest.captures[0].file.slice(2),import.meta.url)));

test('scientific names are encoded and unrestricted by the starting list',()=>{
 assert.equal(searchPath('  Crassostrea gigas  '), 'AphiaRecordsByName/Crassostrea%20gigas?like=false&marine_only=true&extant_only=false&offset=1');
 assert.equal(searchPath('140480'),'AphiaRecordByAphiaID/140480');
 assert.match(searchPath('Mya',{partial:true,marineOnly:false,offset:51}),/like=true&marine_only=false&extant_only=false&offset=51$/);
});
test('invalid IDs, empty queries and markup fail before a request',()=>{
 for(const value of ['', '0', '999999999999999999999','<img>','a'.repeat(201)])assert.throws(()=>queryInput(value));
});
test('a new configured starter is usable beyond the original count',()=>{
 const expanded=normalizeConfig({...config,startingNames:[...config.startingNames,{name:'Patella vulgata',label:'Common limpet'}]});
 assert.equal(expanded.startingNames.length,config.startingNames.length+1);
 assert.match(searchPath(expanded.startingNames.at(-1).name),/Patella%20vulgata/);
 assert.throws(()=>normalizeConfig({...config,apiBase:'https://elsewhere.invalid/'}));
});
test('null/204 responses represent zero results; bad records are rejected',()=>{
 assert.deepEqual(recordsFromResponse(null),[]);
 assert.equal(recordsFromResponse(sample.records[0].record).length,1);
 assert.throws(()=>recordsFromResponse({message:'not a name'}));
});
test('classification follows nested rank nodes and stops at cycles',()=>{
 const tree={AphiaID:1,scientificname:'Animalia',rank:'Kingdom',child:{AphiaID:2,scientificname:'Mollusca',rank:'Phylum',child:null}};
 assert.deepEqual(lineage(tree).map(x=>x.name),['Animalia','Mollusca']);
 tree.child.child=tree;assert.equal(lineage(tree).length,2);assert.deepEqual(lineage(null),[]);
});
test('synonyms are resolved using accepted AphiaID, not status guesses',()=>{
 const result=acceptedName({AphiaID:5,valid_AphiaID:6,valid_name:'Accepted name',status:'unaccepted'});
 assert.equal(result.changed,true);assert.equal(result.id,6);
 assert.equal(acceptedName(sample.records[0].record).changed,false);
 assert.equal(acceptedName({AphiaID:5,status:'unaccepted'}).name,null);
});
test('saved and exported records have valid provenance and arrays',()=>{
 assert.ok(validateCapture(sample).records.length > 0);
 const broken=structuredClone(sample);broken.records[0].retrievedAt='unknown';assert.throws(()=>validateCapture(broken));
 const emptyEvidence=structuredClone(sample);emptyEvidence.records[0].sources=null;assert.throws(()=>validateCapture(emptyEvidence));
});
test('only web source links can be opened',()=>{
 assert.equal(safeURL('javascript:alert(1)'),null);assert.equal(safeURL('https://name:pass@example.com/'),null);assert.equal(safeURL('https://www.marinespecies.org/'),'https://www.marinespecies.org/');
});
test('CSV preserves dated source columns and neutralizes spreadsheet formulas',()=>{
 const entry=structuredClone(sample.records[0]);entry.record.scientificname='=SUM(1,2)';entry.record.authority='A "name"';
 const result=csv([entry]);assert.match(result,/"'=SUM\(1,2\)"/);assert.match(result,/"A ""name"""/);assert.match(result,/retrievedAt/);assert.match(result,/p=taxdetails/);
});
test('API client treats HTTP errors and HTML challenges as failures',async()=>{
 const response=(status,type)=>({ok:status===200,status,headers:{get:()=>type},json:async()=>[]});
 await assert.rejects(createClient(config,async()=>response(403,'text/html'))('AphiaRecordByAphiaID/1'),/403/);
 await assert.rejects(createClient(config,async()=>response(200,'text/html'))('AphiaRecordByAphiaID/1'),/page instead/);
 assert.equal(await createClient(config,async()=>response(204,''))('AphiaRecordByAphiaID/1'),null);
});
test('API requests omit credentials, keep keys out and use official endpoints',async()=>{
 let called;
 const client=createClient(config,async(url,options)=>{called={url,options};return{ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>sample.records[0].record};});
 const record=await client('AphiaRecordByAphiaID/140480');assert.equal(record.AphiaID,140480);assert.equal(called.url,API+'AphiaRecordByAphiaID/140480');assert.equal(called.options.credentials,'omit');assert.equal(called.options.referrerPolicy,'no-referrer');
 await assert.rejects(client('https://elsewhere.invalid/'),/Unsupported/);
});
