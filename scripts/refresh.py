#!/usr/bin/env python3
"""Capture selected WoRMS records; keep every earlier capture and build offline."""
import datetime as dt
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'web/config.json'
ENDPOINTS = {'classification': 'AphiaClassificationByAphiaID', 'synonyms': 'AphiaSynonymsByAphiaID', 'distributions': 'AphiaDistributionsByAphiaID', 'sources': 'AphiaSourcesByAphiaID'}


def read_json(url, timeout):
    req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'CoolCode MarineNames/1.0 (+https://coolcode.ca/marinenames/)'})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        if response.status == 204:
            return None
        if 'json' not in response.headers.get('Content-Type', ''):
            raise ValueError('WoRMS did not return JSON; no capture was published')
        return json.load(response)


def capture(config, fetch=read_json, pause=time.sleep):
    base = config['apiBase']
    if base != 'https://www.marinespecies.org/rest/':
        raise ValueError('Only the documented HTTPS WoRMS REST service is supported')
    records, seen = [], set()
    gap = max(1, config['requestGapMs'] / 1000)
    def get(path):
        pause(gap)
        return fetch(base + path, config['timeoutMs'] / 1000)
    for item in config['startingNames']:
        name = item['name'].strip()
        if not name or len(name) > 200:
            raise ValueError('Every configured starting name must have 1–200 characters')
        matches = get('AphiaRecordsByName/' + urllib.parse.quote(name, safe='') + '?like=false&marine_only=' + str(config.get('marineOnly', True)).lower() + '&extant_only=' + str(config.get('extantOnly', False)).lower())
        if not isinstance(matches, list) or not matches:
            raise ValueError(f'No exact record for {name}; earlier data remains unchanged')
        for record in matches:
            identity = record.get('AphiaID')
            if not isinstance(identity, int) or identity < 1 or not record.get('scientificname'):
                raise ValueError('Invalid WoRMS name record')
            if identity in seen:
                continue
            seen.add(identity)
            entry = {'record': record, 'label': item.get('label', ''), 'retrievedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'errors': {}}
            for key, endpoint in ENDPOINTS.items():
                path = f'{endpoint}/{identity}'
                if key == 'synonyms':
                    synonyms, offset = [], 1
                    while True:
                        batch = get(path + '?offset=' + str(offset)) or []
                        if not isinstance(batch, list):
                            raise ValueError('Unexpected synonyms payload')
                        synonyms.extend(batch)
                        if len(batch) < 50:
                            break
                        offset += 50
                    entry[key] = synonyms
                    entry['synonymsComplete'] = True
                else:
                    value = get(path)
                    if key == 'classification':
                        if value is not None and not isinstance(value, dict):
                            raise ValueError('Unexpected classification payload')
                        entry[key] = value
                    else:
                        if value is not None and not isinstance(value, list):
                            raise ValueError(f'Unexpected {key} payload')
                        entry[key] = value or []
            records.append(entry)
            print(f'Captured {record["scientificname"]}: {len(entry["synonyms"])} names, {len(entry["distributions"])} distribution records', flush=True)
    if not records:
        raise ValueError('Configure at least one starting name')
    return {'schemaVersion': 1, 'source': 'WoRMS REST', 'capturedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'records': records}


def main():
    config = json.loads(CONFIG.read_text())
    data = capture(config)
    directory = ROOT / 'web/data/captures'
    directory.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    target = directory / (stamp + '.json')
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    manifest_path = ROOT / 'web/data/index.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'captures': []}
    manifest['captures'].insert(0, {'file': './data/captures/' + target.name, 'capturedAt': data['capturedAt'], 'count': len(data['records'])})
    staged = manifest_path.with_suffix('.tmp')
    staged.write_text(json.dumps(manifest, indent=2) + '\n')
    staged.replace(manifest_path)
    print('Saved', target.relative_to(ROOT), '— all earlier captures retained')

if __name__ == '__main__':
    main()
