import {API, recordURL, safeURL, queryInput, searchPath, recordsFromResponse, lineage, acceptedName, normalizeConfig, validateCapture, csv, createClient} from './model.mjs';
const $=id=>document.getElementById(id);
let config, client, manifest, entries=[], selected=null, busy=false, liveSearch=null, savedIndex=0;
const cache=new Map();
const el=(tag,text='',className='')=>{const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;};
const date=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-CA',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC':'Not reported';
function status(text,error=false){$('status').textContent=text;$('status').className=error?'error':'';}
function setBusy(value){busy=value;$('search').disabled=value;$('more-results').disabled=value;$('saved').disabled=value;$('capture').disabled=value;$('import').disabled=value;$('search').textContent=value?'Reading WoRMS…':'Search WoRMS ↗';}
function link(text,url){const a=el('a',text);const target=safeURL(url);if(target){a.href=target;a.target='_blank';a.rel='noopener noreferrer';}return a;}
function download(name,content,type){const a=document.createElement('a');const url=URL.createObjectURL(new Blob([content],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function captureFile(entry){return {schemaVersion:1,source:'WoRMS REST',capturedAt:entry.retrievedAt,records:[entry]};}
function renderList(){
  $('results').replaceChildren();
  $('result-count').textContent=`${entries.length} name${entries.length===1?'':'s'} · choose a record`;
  entries.forEach((entry,index)=>{const r=entry.record;const button=el('button','','name-card'+(selected?.record.AphiaID===r.AphiaID?' active':''));button.type='button';button.setAttribute('aria-pressed',String(selected?.record.AphiaID===r.AphiaID));button.append(el('strong',r.scientificname),el('span',entry.label||`${r.rank||'Rank unreported'} · AphiaID ${r.AphiaID}`),el('span',r.status||'Status not reported'));button.addEventListener('click',()=>{if(!busy)selectEntry(index);});$('results').append(button);});
}
function evidenceSection(title,items,note,entry,key,renderItem,open=false){
  const details=el('details');details.open=open;
  const summary=el('summary');summary.append(el('h3',title),el('span',entry.errors?.[key]?'Unavailable':`${items.length} ${key==='sources'?'sources':'records'}${key==='synonyms'&&!entry.synonymsComplete?' loaded':''}`));details.append(summary,el('p',note,'section-note'));
  if(entry.errors?.[key])details.append(el('p',`This section could not be retrieved: ${entry.errors[key]}`,'warning'));
  else if(!items.length)details.append(el('p','No records returned by WoRMS for this name.','section-note'));
  else{const list=el('ul','','evidence-list');items.forEach(item=>list.append(renderItem(item)));details.append(list);}
  return details;
}
function renderDetail(entry){
  const r=entry.record;const detail=$('detail');detail.replaceChildren();
  const top=el('div','','record-top');top.append(el('p',`WoRMS RECORD / ${r.AphiaID}`,'section-no'),el('span',r.status||'Status not reported','pill'+(r.status==='accepted'?'':' other')));detail.append(top,el('h2',r.scientificname),el('p',r.authority||'Authority not reported','authority'));
  const meta=el('div','','record-meta');meta.append(el('span',`Retrieved ${date(entry.retrievedAt)}`),el('span',`Record modified ${date(r.modified)}`));detail.append(meta);
  const accepted=acceptedName(r);
  if(accepted.changed){const block=el('div','','accepted');const p=el('p','Accepted name: ');p.append(link(`${accepted.name||'Open accepted record'} ${accepted.authority}`,recordURL(accepted.id)));block.append(p);if(r.unacceptreason)block.append(el('p',`Register’s reason: ${r.unacceptreason}`));const button=el('button','Look up the accepted record','text-button');button.addEventListener('click',()=>{if(!busy){$('query').value=String(accepted.id);runSearch();}});block.append(button);detail.append(block);}
  const actions=el('div','','record-actions');actions.append(link('Open original record ↗',recordURL(r.AphiaID)));
  const json=el('button','Save record JSON');json.addEventListener('click',()=>download(`marinenames-${r.AphiaID}.json`,JSON.stringify(captureFile(entry),null,2),'application/json'));const csvButton=el('button','Save name CSV');csvButton.addEventListener('click',()=>download(`marinenames-${r.AphiaID}.csv`,csv([entry]),'text/csv;charset=utf-8'));actions.append(json,csvButton);detail.append(actions);
  const taxonomy=el('section','','taxonomy');taxonomy.append(el('h3','A place in the taxonomy'));
  const levels=lineage(entry.classification);
  if(entry.errors?.classification)taxonomy.append(el('p',`Classification could not be retrieved: ${entry.errors.classification}`,'section-note'));
  else if(!levels.length)taxonomy.append(el('p','No classification returned by WoRMS.','section-note'));
  else{const list=el('ol');levels.filter(x=>x.name!=='Biota').forEach(level=>{const item=el('li');item.append(el('small',level.rank),link(level.name,recordURL(level.id)));list.append(item);});taxonomy.append(list);}detail.append(taxonomy);
  const habitat=value=>value===1?'Yes':value===0?'No':'Not reported';
  const facts=el('div','','facts');for(const [label,key] of [['Marine','isMarine'],['Brackish','isBrackish'],['Freshwater','isFreshwater'],['Extinct','isExtinct']]){const p=el('div');p.append(el('span',`${label}: `),document.createTextNode(habitat(r[key])));facts.append(p);}detail.append(facts);
  const evidence=el('div','','evidence');
  const names=evidenceSection('Other names',entry.synonyms,'Synonyms and alternative name forms in this retrieval. These are current name relationships, not a timeline of when a classification changed.',entry,'synonyms',item=>{const li=el('li');li.append(link(item.scientificname,recordURL(item.AphiaID)),el('small',`${item.authority||'Authority unreported'} · ${item.status||'Status unreported'}`));if(item.unacceptreason)li.append(el('small',item.unacceptreason));return li;},true);
  if(!entry.synonymsComplete&&!entry.errors?.synonyms){const more=el('button','Load next 50 other names','secondary');more.addEventListener('click',async()=>{if(busy)return;setBusy(true);try{const rows=recordsFromResponse(await client(`AphiaSynonymsByAphiaID/${r.AphiaID}?offset=${entry.synonyms.length+1}`));entry.synonyms.push(...rows);entry.synonymsComplete=rows.length<50;renderDetail(entry);status(`${rows.length} additional names retrieved.`);}catch(error){status(`${error.message} Existing records are unchanged.`,true);}finally{setBusy(false);}});names.append(more);}evidence.append(names);
  evidence.append(evidenceSection('Reported distributions',entry.distributions,'Places reported for this name, not a complete range map. Record and review statuses are preserved. No observation date means current presence is unknown.',entry,'distributions',item=>{const li=el('li');li.append(link(item.locality||'Unnamed locality',item.locationID));li.append(el('small',[item.higherGeography,`Record: ${item.recordStatus||'not reported'}`,`Review: ${item.qualityStatus||'not reported'}`].filter(Boolean).join(' · ')));const extra=[item.establishmentMeans,item.invasiveness,item.occurrence].filter(Boolean);if(extra.length)li.append(el('small',extra.join(' · ')));return li;}));
  evidence.append(evidenceSection('Literature & sources',entry.sources,'References attached to this taxon by WoRMS. These sources are not necessarily evidence for every distribution above.',entry,'sources',item=>{const li=el('li');li.append(el('p',item.reference||'Reference text not supplied'));li.append(link('WoRMS source record ↗',item.url||`https://www.marinespecies.org/aphia.php?p=sourcedetails&id=${Number(item.source_id)}`));if(safeURL(item.link)){li.append(document.createTextNode(' · '),link('Publication ↗',item.link));}li.append(el('small',[item.use,item.page?`Page ${item.page}`:''].filter(Boolean).join(' · ')));return li;}));detail.append(evidence);
  const citation=el('div','','citation');citation.append(el('strong','CITE THIS NAME RECORD'),el('p',r.citation||`World Register of Marine Species. ${r.scientificname}. AphiaID ${r.AphiaID}. Retrieved ${date(entry.retrievedAt)}.`));detail.append(citation);
}
async function detailsFor(record){
  const key=record.AphiaID;if(cache.has(key))return cache.get(key);
  const entry={record,label:'',retrievedAt:new Date().toISOString(),classification:null,synonyms:[],distributions:[],sources:[],synonymsComplete:false,errors:{}};
  for(const [field,endpoint] of [['classification','AphiaClassificationByAphiaID'],['synonyms','AphiaSynonymsByAphiaID'],['distributions','AphiaDistributionsByAphiaID'],['sources','AphiaSourcesByAphiaID']]){
    try{const value=await client(`${endpoint}/${key}${field==='synonyms'?'?offset=1':''}`);if(field==='classification'){if(value!==null&&(typeof value!=='object'||Array.isArray(value)))throw new Error('Unexpected classification response.');entry[field]=value;}else{if(value!==null&&!Array.isArray(value))throw new Error('Unexpected evidence response.');entry[field]=value||[];}if(field==='synonyms'){entry[field]=recordsFromResponse(value);entry.synonymsComplete=entry.synonyms.length<50;}}
    catch(error){entry.errors[field]=error.message;}
  }
  cache.set(key,entry);return entry;
}
async function selectEntry(index){
  const original=entries[index];if(!original)return;
  if(original.retrievedAt){selected=original;renderList();renderDetail(selected);return;}
  setBusy(true);status(`Reading classification, other names, distributions and sources for ${original.record.scientificname}…`);
  try{const value=await detailsFor(original.record);entries[index]=value;selected=value;renderList();renderDetail(value);const failed=Object.keys(value.errors).length;status(failed?`Name record loaded; ${failed} evidence section${failed===1?'':'s'} unavailable. See the section notes.`:`Live WoRMS record retrieved. Save JSON to keep this dated copy.`,Boolean(failed));}
  catch(error){status(`${error.message} Previous results are unchanged.`,true);}finally{setBusy(false);}
}
async function runSearch(append=false){
  if(busy)return;
  let query,options;
  try{query=append?liveSearch.query:$('query').value.trim();queryInput(query);options=append?{...liveSearch.options,offset:liveSearch.offset+50}:{partial:$('partial').checked,marineOnly:$('marine-only').checked,extantOnly:$('extant-only').checked,offset:1};}catch(error){status(error.message,true);return;}
  setBusy(true);status(`Looking up “${query}” in WoRMS…`);
  try{
    const rows=recordsFromResponse(await client(searchPath(query,options)));
    if(!rows.length){status(`No matching names returned for “${query}”. Earlier results remain below. Try a genus or enable “Names starting with my search”.`);$('more-results').hidden=true;return;}
    const newEntries=rows.map(record=>({record}));
    entries=append?[...entries,...newEntries.filter(x=>!entries.some(e=>e.record.AphiaID===x.record.AphiaID))]:newEntries;
    liveSearch={query,options,offset:options.offset};$('results-title').textContent='Search results';$('more-results').hidden=queryInput(query).type==='id'||rows.length<50;
    status(`${entries.length} names loaded. Choose a name to inspect its evidence.`);renderList();
    if(!append){setBusy(false);await selectEntry(0);}
  }catch(error){status(`${error.message} Previous results are unchanged. You can still use saved records or open WoRMS directly.`,true);}finally{setBusy(false);}
}
async function loadSaved(index){
  if(busy)return;setBusy(true);
  try{const item=manifest.captures[index];if(!item||!/^\.\/data\/captures\/[A-Za-z0-9_-]+\.json$/.test(item.file))throw new Error('Invalid saved-capture path.');const response=await fetch(item.file);if(!response.ok)throw new Error('Saved capture could not be opened.');const data=validateCapture(await response.json());entries=data.records;selected=entries[0]||null;liveSearch=null;savedIndex=index;$('results-title').textContent='Saved names';$('more-results').hidden=true;renderList();if(selected)renderDetail(selected);status(`Saved WoRMS capture · ${date(data.capturedAt)} · ${entries.length} names. Search above to look up any other name.`);}
  catch(error){status(error.message,true);}finally{setBusy(false);}
}
$('search-form').addEventListener('submit',event=>{event.preventDefault();runSearch();});
$('more-results').addEventListener('click',()=>runSearch(true));
$('capture').addEventListener('change',()=>loadSaved(Number($('capture').value)));
$('saved').addEventListener('click',()=>loadSaved(savedIndex));
$('import').addEventListener('change',async()=>{const file=$('import').files[0];if(!file||busy)return;try{if(file.size>config.maxImportBytes)throw new Error(`Choose a file smaller than ${Math.round(config.maxImportBytes/1000000)} MB.`);const data=validateCapture(JSON.parse(await file.text()));if(!data.records.length)throw new Error('This file contains no name records.');entries=data.records;selected=entries[0];liveSearch=null;$('results-title').textContent='Imported names';$('more-results').hidden=true;renderList();renderDetail(selected);status(`Imported ${entries.length} dated name records. This file stays in your browser tab.`);}catch(error){status(`${error.message} Previous results are unchanged.`,true);}finally{$('import').value='';}});
async function start(){
  try{const response=await fetch('./config.json');if(!response.ok)throw new Error('Configuration could not be loaded.');config=normalizeConfig(await response.json());client=createClient(config);$('marine-only').checked=config.marineOnly!==false;$('extant-only').checked=config.extantOnly===true;
    config.startingNames.forEach(item=>{const button=el('button',item.name);button.type='button';button.title=item.label||item.name;button.addEventListener('click',()=>{if(busy)return;$('query').value=item.name;const index=entries.findIndex(x=>x.record.scientificname===item.name&&x.retrievedAt);if(index>=0){selectEntry(index);status(`Opened saved record for ${item.name}. Use Search WoRMS for a fresh lookup.`);}else runSearch();});$('starters').append(button);});
    const response2=await fetch('./data/index.json');if(!response2.ok)throw new Error('Saved records could not be loaded. Search WoRMS above to begin.');manifest=await response2.json();if(!Array.isArray(manifest.captures)||!manifest.captures.length)throw new Error('No saved captures are available. Search WoRMS above to begin.');manifest.captures.forEach((item,index)=>{const option=el('option',`${date(item.capturedAt)} · ${item.count} names`);option.value=String(index);$('capture').append(option);});await loadSaved(0);
  }catch(error){status(error.message,true);}
}
start();
