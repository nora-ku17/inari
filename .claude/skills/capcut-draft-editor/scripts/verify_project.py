#!/usr/bin/env python3
"""Sanity-check generated CapCut projects: unique ids, every reference resolves, no orphan materials,
media files exist, video track contiguous, root draft_info.json == timeline copy, registered in
root_meta_info.json. Prints a track summary. Exit code 1 if something is wrong.

Usage:  python3 verify_project.py 旅行_前半 旅行_後半
"""
import argparse, json, glob, os, sys

DEFAULT_ROOT = '~/Movies/CapCut/User Data/Projects/com.lveditor.draft'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=DEFAULT_ROOT)
    ap.add_argument('projects', nargs='+')
    a = ap.parse_args()
    root = os.path.expanduser(a.root)
    registered = [e['draft_name'] for e in json.load(open(root + '/root_meta_info.json'))['all_draft_store']]
    bad = False
    for name in a.projects:
        f = glob.glob('%s/%s/Timelines/*/draft_info.json' % (root, name))[0]
        d = json.load(open(f))
        m = d['materials']
        print('==', name, 'dur %.1fs' % (d['duration'] / 1e6), [(t['type'], len(t['segments'])) for t in d['tracks']])
        ids = [e['id'] for k, v in m.items() if isinstance(v, list) for e in v if isinstance(e, dict) and 'id' in e]
        segs = [s for t in d['tracks'] for s in t['segments']]
        refd = {r for s in segs for r in s['extra_material_refs'] + [s['material_id']]}
        checks = {
            'ids unique': len(ids) == len(set(ids)),
            'references resolve': refd <= set(ids),
            'no orphan materials': not (set(ids) - refd),
            'root copy == timeline copy': open(f, 'rb').read() == open('%s/%s/draft_info.json' % (root, name), 'rb').read(),
            'registered in root_meta_info': name in registered,
        }
        paths = [e['path'] for k in ('videos', 'audios') for e in m.get(k, []) if e.get('path')]
        missing = [p for p in paths if not os.path.exists(p)]
        checks['media files exist'] = not missing
        v = next(t for t in d['tracks'] if t['type'] == 'video')['segments']
        pos, ok = 0, True
        for s in v:
            if abs(s['target_timerange']['start'] - pos) > 1:
                ok = False
            pos = s['target_timerange']['start'] + s['target_timerange']['duration']
        checks['video track contiguous'] = ok and abs(pos - d['duration']) <= 1
        for k, ok in checks.items():
            print('  %-30s %s' % (k, 'ok' if ok else 'NG'))
            bad |= not ok
        if missing:
            print('  missing:', missing[:5])
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
