#!/usr/bin/env python3
"""Add a persistent upper-left typewriter label to every "section" of existing CapCut projects,
where a section starts at each big gap between the shooting times of consecutive clips.

The projects are patched IN PLACE (they may contain the user's own edits), after backing up
draft_info.json to draft_info.json.bak_labels. Quit CapCut first.

Label text defaults to the shooting date/time of the section's first clip ("8/23 10:48") because
place names are not knowable from the files; use --labels-json to supply real names, or edit in CapCut.
Look (position, size, shadow, typewriter animation, typing sound) is copied from the template project.

Usage:
    python3 add_labels.py --template 0721-コピー --projects 旅行_前半 旅行_後半 [--gap-min 30] [--min-sec 8]
    # real names: --labels-json '{"旅行_前半": ["福井駅", "恐竜博物館", ...]}'  (one per section, in order)
"""
import argparse, json, os, shutil, uuid, copy, glob, datetime, re

DEFAULT_ROOT = '~/Movies/CapCut/User Data/Projects/com.lveditor.draft'
LABEL_VOL = 0.8944611549377441


def nid():
    return str(uuid.uuid4()).upper()


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))


def tl_file(base):
    fs = glob.glob(base + '/Timelines/*/draft_info.json')
    assert len(fs) == 1, fs
    return fs[0]


def clip_time(name):
    m = re.search(r'(\d{8})_(\d{6})', name)
    return datetime.datetime.strptime(m.group(1) + m.group(2), '%Y%m%d%H%M%S')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=DEFAULT_ROOT)
    ap.add_argument('--template', required=True)
    ap.add_argument('--projects', nargs='+', required=True)
    ap.add_argument('--gap-min', type=float, default=30, help='minutes between clips that start a new section')
    ap.add_argument('--min-sec', type=float, default=8.0, help='shorter sections are merged into the previous one')
    ap.add_argument('--labels-json', default=None, help='JSON {project: [label, ...]} overriding the default text')
    a = ap.parse_args()
    ROOT = os.path.expanduser(a.root)
    custom = json.loads(a.labels_json) if a.labels_json else {}

    tpl = json.load(open(tl_file(ROOT + '/' + a.template)))
    tpl_all = {}
    for k, v in tpl['materials'].items():
        if isinstance(v, list):
            for e in v:
                if isinstance(e, dict) and 'id' in e:
                    tpl_all[e['id']] = (k, e)
    tpl_text_tracks = [t for t in tpl['tracks'] if t['type'] == 'text']
    tpl_label_seg = tpl_text_tracks[1]['segments'][1]           # a location label of the template
    tpl_label_text = tpl_all[tpl_label_seg['material_id']][1]
    tpl_label_anim = tpl_all[tpl_label_seg['extra_material_refs'][0]][1]
    assert tpl_label_anim['animations'][0]['name'] == 'タイプ'
    tpl_sfx_seg = None
    for t in tpl['tracks']:
        if t['type'] == 'audio':
            for s in t['segments']:
                x = tpl_all[s['material_id']][1]
                if 'タイピング' in x['name'] and s['target_timerange']['duration'] == 766666:
                    tpl_sfx_seg = s
                    break
        if tpl_sfx_seg:
            break
    assert tpl_sfx_seg is not None, 'template has no short typing sound (766666us)'

    def add_audio_segment(d, track, tseg, start, dur, volume):
        m = d['materials']
        x = copy.deepcopy(tpl_all[tseg['material_id']][1])
        x['id'] = nid()
        m.setdefault('audios', []).append(x)
        s = copy.deepcopy(tseg)
        s['id'] = nid()
        s['material_id'] = x['id']
        s['source_timerange'] = {'start': 0, 'duration': dur}
        s['target_timerange'] = {'start': start, 'duration': dur}
        s['volume'] = volume
        s['last_nonzero_volume'] = volume
        refs = []
        for r in tseg['extra_material_refs']:
            k, e = tpl_all[r]
            h = copy.deepcopy(e)
            h['id'] = nid()
            m.setdefault(k, []).append(h)
            refs.append(h['id'])
        s['extra_material_refs'] = refs
        track['segments'].append(s)

    for name in a.projects:
        base = ROOT + '/' + name
        tlf = tl_file(base)
        for p in [tlf, base + '/draft_info.json']:
            if not os.path.exists(p + '.bak_labels'):
                shutil.copy(p, p + '.bak_labels')
        d = json.load(open(tlf))
        m = d['materials']
        vid = {v['id']: v for v in m['videos']}
        vt = next(t for t in d['tracks'] if t['type'] == 'video')
        vsegs = sorted(vt['segments'], key=lambda s: s['target_timerange']['start'])
        total = vsegs[-1]['target_timerange']['start'] + vsegs[-1]['target_timerange']['duration']
        names = [vid[s['material_id']]['material_name'] for s in vsegs]
        starts = [s['target_timerange']['start'] for s in vsegs]

        # the first label must wait until the title (a text starting in the first second) is gone
        title_end = 0
        for t in d['tracks']:
            if t['type'] == 'text':
                for s in t['segments']:
                    if s['target_timerange']['start'] < 1000000:
                        title_end = max(title_end, s['target_timerange']['start'] + s['target_timerange']['duration'])

        idx = [0]
        for i in range(1, len(vsegs)):
            gap = abs((clip_time(names[i]) - clip_time(names[i - 1])).total_seconds()) / 60
            if gap >= a.gap_min:
                idx.append(i)
        changed = True
        while changed and len(idx) > 1:
            changed = False
            for k in range(1, len(idx)):
                end = starts[idx[k + 1]] if k + 1 < len(idx) else total
                if (end - starts[idx[k]]) / 1e6 < a.min_sec:
                    del idx[k]
                    changed = True
                    break
        labels = []
        for k, i in enumerate(idx):
            st = starts[i]
            if k == 0:
                st = max(st, title_end)
            en = starts[idx[k + 1]] if k + 1 < len(idx) else total
            if en - st < 1000000:
                continue
            t = clip_time(names[i])
            text = '%d/%d %d:%02d' % (t.month, t.day, t.hour, t.minute)
            if name in custom and k < len(custom[name]):
                text = custom[name][k]
            labels.append((st, en, text))

        ltrack = {'id': nid(), 'type': 'text', 'flag': 0, 'attribute': 0, 'name': '', 'is_default_name': True, 'segments': []}
        sfx_track = None
        for t in d['tracks']:
            if t['type'] == 'audio':
                for s in t['segments']:
                    x = next((q for q in m.get('audios', []) if q['id'] == s['material_id']), None)
                    if x and x.get('type') == 'sound' and 'タイピング' in x['name']:
                        sfx_track = t
                        break
            if sfx_track:
                break
        if sfx_track is None:
            sfx_track = {'id': nid(), 'type': 'audio', 'flag': 0, 'attribute': 0, 'name': '', 'is_default_name': True, 'segments': []}
            d['tracks'].append(sfx_track)

        for st, en, text in labels:
            txt = copy.deepcopy(tpl_label_text)
            txt['id'] = nid()
            c = json.loads(txt['content'])
            c['text'] = text
            for stl in c['styles']:
                stl['range'] = [0, len(text)]
            txt['content'] = json.dumps(c, ensure_ascii=False, separators=(',', ':'))
            m.setdefault('texts', []).append(txt)
            an = copy.deepcopy(tpl_label_anim)
            an['id'] = nid()
            m.setdefault('material_animations', []).append(an)
            sg = copy.deepcopy(tpl_label_seg)
            sg['id'] = nid()
            sg['material_id'] = txt['id']
            sg['extra_material_refs'] = [an['id']]
            sg['target_timerange'] = {'start': st, 'duration': en - st}
            ltrack['segments'].append(sg)
            add_audio_segment(d, sfx_track, tpl_sfx_seg, st, tpl_sfx_seg['target_timerange']['duration'], LABEL_VOL)
        sfx_track['segments'].sort(key=lambda s: s['target_timerange']['start'])

        last_text = max(i for i, t in enumerate(d['tracks']) if t['type'] == 'text')
        d['tracks'].insert(last_text + 1, ltrack)

        blob = dump(d)
        for p in [tlf, base + '/draft_info.json']:
            open(p, 'w', encoding='utf-8').write(blob)
        for p in [tlf + '.bak', base + '/draft_info.json.bak', os.path.dirname(tlf) + '/template-2.tmp', base + '/template-2.tmp']:
            if os.path.exists(p):
                open(p, 'w', encoding='utf-8').write(blob)

        print('==', name, 'sections:', len(labels))
        for st, en, text in labels:
            print('   %2d:%02d - %2d:%02d  %s' % (st // 6e7, (st / 1e6) % 60, en // 6e7, (en / 1e6) % 60, text))


if __name__ == '__main__':
    main()
