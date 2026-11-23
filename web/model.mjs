export const API = 'https://www.marinespecies.org/rest/';
export const recordURL = id => `https://www.marinespecies.org/aphia.php?p=taxdetails&id=${Number(id)}`;
export function safeURL(value) { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } }
export function queryInput(value) {
  const text = String(value).trim().replace(/\s+/g, ' ');
  if (!text || text.length > 200 || /[\u0000-\u001f<>]/.test(text)) throw new Error('Enter a scientific name or a positive AphiaID, up to 200 characters.');
  if (/^\d+$/.test(text)) { const id = Number(text); if (!Number.isSafeInteger(id) || id < 1) throw new Error('An AphiaID must be a positive whole number.'); return {type:'id', value:id}; }
  return {type:'name', value:text};
}
export function searchPath(query, {partial=false, marineOnly=true, extantOnly=false, offset=1} = {}) {
  const input = queryInput(query);
  if (input.type === 'id') return `AphiaRecordByAphiaID/${input.value}`;
  if (!Number.isInteger(offset) || offset < 1) throw new Error('Invalid page offset.');
  return `AphiaRecordsByName/${encodeURIComponent(input.value)}?like=${Boolean(partial)}&marine_only=${Boolean(marineOnly)}&extant_only=${Boolean(extantOnly)}&offset=${offset}`;
}
export function validateRecord(record) {
  if (!record || typeof record !== 'object' || !Number.isSafeInteger(record.AphiaID) || record.AphiaID < 1 || typeof record.scientificname !== 'string' || !record.scientificname.trim()) throw new Error('The response is not a WoRMS name record.');
  return record;
}
export function recordsFromResponse(value) { if (value === null) return []; return (Array.isArray(value) ? value : [value]).map(validateRecord); }
export function lineage(node) {
  const result = [], visited = new Set();
  while (node && typeof node === 'object' && !Array.isArray(node) && result.length < 100) {
    if (visited.has(node.AphiaID)) break;
    visited.add(node.AphiaID);
    if (typeof node.scientificname === 'string') result.push({name:node.scientificname, rank:node.rank || 'Rank unreported', id:node.AphiaID});
    node = node.child;
  }
  return result;
}
export function acceptedName(record) { return {name:record.valid_name || null, id:record.valid_AphiaID || null, authority:record.valid_authority || '', changed:Boolean(record.valid_AphiaID && record.valid_AphiaID !== record.AphiaID)}; }
export function normalizeConfig(config) {
  if (config?.apiBase !== API) throw new Error('The configuration must use the official WoRMS REST service.');
  if (!Array.isArray(config.startingNames) || !config.startingNames.every(x => typeof x.name === 'string' && x.name.trim())) throw new Error('Configure startingNames as an array of names.');
  return {...config, timeoutMs:Math.max(3000, Number(config.timeoutMs) || 25000), requestGapMs:Math.max(1000, Number(config.requestGapMs) || 1000), maxImportBytes:Math.max(1000, Number(config.maxImportBytes) || 5000000)};
}
export function validateCapture(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.records) || !Number.isFinite(Date.parse(value.capturedAt))) throw new Error('Choose a Marine Names JSON export with dated name records.');
  for (const entry of value.records) {
    validateRecord(entry.record);
    if (!Number.isFinite(Date.parse(entry.retrievedAt))) throw new Error('Each imported name needs its retrieval date.');
    for (const key of ['synonyms','sources','distributions']) if (!Array.isArray(entry[key])) throw new Error(`Imported ${key} must be an array.`);
    entry.synonyms.forEach(validateRecord);
    if (entry.classification !== null && typeof entry.classification !== 'object') throw new Error('Imported classification must be an object or null.');
    if (!entry.sources.every(x => x && typeof x === 'object') || !entry.distributions.every(x => x && typeof x === 'object')) throw new Error('Invalid imported evidence record.');
  }
  return value;
}
export function csv(records) {
  const quote = value => '"' + String(value ?? '').replace(/^[\s]*[=+@-]/, m => "'" + m).replaceAll('"','""') + '"';
  const columns=['AphiaID','scientificname','authority','status','valid_AphiaID','valid_name','rank','family','modified','retrievedAt','source'];
  return [columns.map(quote).join(','), ...records.map(e => columns.map(k => quote(k === 'retrievedAt' ? e.retrievedAt : k === 'source' ? recordURL(e.record.AphiaID) : e.record[k])).join(','))].join('\r\n');
}
export function createClient(config, fetcher=fetch, wait=ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let lastStarted=0;
  return async path => {
    if (!/^Aphia(?:RecordsByName|RecordByAphiaID|ClassificationByAphiaID|SynonymsByAphiaID|DistributionsByAphiaID|SourcesByAphiaID)\//.test(path)) throw new Error('Unsupported WoRMS operation.');
    const delay=Math.max(0, config.requestGapMs - (Date.now()-lastStarted));
    if (delay) await wait(delay);
    lastStarted=Date.now();
    const controller=new AbortController();
    const timer=setTimeout(() => controller.abort(),config.timeoutMs);
    try {
      const response=await fetcher(API + path, {signal:controller.signal, headers:{Accept:'application/json'}, credentials:'omit', referrerPolicy:'no-referrer'});
      if (response.status === 204) return null;
      if (!response.ok) throw new Error(`WoRMS returned HTTP ${response.status}.`);
      if (!(response.headers.get('Content-Type') || '').includes('json')) throw new Error('WoRMS returned a page instead of API data.');
      return await response.json();
    } catch(error) { if(error.name === 'AbortError') throw new Error('WoRMS took too long to respond.'); throw error; }
    finally {clearTimeout(timer);}
  };
}
