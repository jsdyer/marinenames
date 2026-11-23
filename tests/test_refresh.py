import copy
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from refresh import capture
ROOT=Path(__file__).resolve().parents[1]

class RefreshTests(unittest.TestCase):
    def test_new_name_and_paginated_synonyms_are_not_capped_by_defaults(self):
        config=json.loads((ROOT/'web/config.json').read_text())
        config['startingNames']=[{'name': 'Additional species', 'label':'Added example'}]
        record={'AphiaID':123,'scientificname':'Additional species'}
        paths=[]
        def fetch(url, timeout):
            paths.append(url)
            if 'AphiaRecordsByName' in url:return [record]
            if 'Synonyms' in url:return [dict(record, AphiaID=i) for i in range(1,51)] if 'offset=1' in url else [dict(record,AphiaID=51)]
            if 'Classification' in url:return {'AphiaID':123,'scientificname':'Additional species','child':None}
            return []
        data=capture(config,fetch,lambda _:None)
        self.assertEqual(len(data['records']),1)
        self.assertEqual(len(data['records'][0]['synonyms']),51)
        self.assertTrue(any('offset=51' in path for path in paths))
        self.assertTrue(data['records'][0]['synonymsComplete'])

    def test_missing_record_aborts_refresh_without_emitting_empty_success(self):
        config=json.loads((ROOT/'web/config.json').read_text())
        with self.assertRaisesRegex(ValueError,'No exact record'):
            capture(config,lambda *_:[],lambda _:None)

    def test_saved_manifest_files_are_valid_and_have_complete_sources(self):
        manifest=json.loads((ROOT/'web/data/index.json').read_text())
        for item in manifest['captures']:
            data=json.loads((ROOT/'web'/item['file']).read_text())
            self.assertEqual(item['count'],len(data['records']))
            for entry in data['records']:
                self.assertTrue(entry['record']['citation'])
                self.assertTrue(entry['record']['AphiaID']>0)
                self.assertIn('retrievedAt',entry)
                self.assertEqual(entry['errors'],{})
