#!/usr/bin/env python3
"""Create a NEW CapCut project that holds every clip of a folder, in time order, uncut.

The new project is cloned from a tiny existing "base" project (one video segment,
e.g. a project that contains a single clip) so that the draft schema of the
installed CapCut version is reused exactly. Nothing existing is modified except
root_meta_info.json (one entry added; backup root_meta_info.json.bak_claude).

Usage:
    python3 build_all_clips.py --clips-dir ~/Desktop/trip --meta /tmp/clips_meta.json \
        --name 旅行_全クリップ --base 1115
Run measure_clips.py first. Quit CapCut before running.
"""
import argparse, json, os, shutil, uuid, time, copy, sys

DEFAULT_ROOT = '~/Movies/CapCut/User Data/Projects/com.lveditor.draft'


def nid():
    return str(uuid.uuid4()).upper()


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=DEFAULT_ROOT)
    ap.add_argument('--clips-dir', required=True)
    ap.add_argument('--meta', required=True, help='json written by measure_clips.py')
    ap.add_argument('--name', required=True, help='name of the new project')
    ap.add_argument('--base', required=True, help='existing small project to clone (1 video segment)')
    ap.add_argument('--fps', type=int, default=30)
    a = ap.parse_args()
    ROOT = os.path.expanduser(a.root)
    VDIR = os.path.abspath(os.path.expanduser(a.clips_dir))
    SRC = ROOT + '/' + a.base
    DST = ROOT + '/' + a.name
    FPS = a.fps

    meta = json.load(open(a.meta))
    on_disk = sorted(f for f in os.listdir(VDIR) if f in meta or f.lower().endswith(('.mp4', '.mov')))
    assert set(meta) == set(on_disk), 'meta and folder differ: %d vs %d' % (len(meta), len(on_disk))
    assert all(meta[k]['duration'] for k in meta), 'missing duration'
    # time order = file name order without extension (camera names embed the timestamp;
    # "x", "x(1)", "x(2)" stay together)
    names = sorted(meta, key=lambda n: os.path.splitext(n)[0])

    sp = json.load(open(SRC + '/Timelines/project.json'))
    sm = json.load(open(SRC + '/draft_meta_info.json'))
    OLD_TL, OLD_PROJ, OLD_DRAFT = sp['main_timeline_id'], sp['id'], sm['draft_id']

    assert not os.path.exists(DST), 'already exists: ' + DST
    shutil.copytree(SRC, DST)
    NEW_TL, NEW_PROJ, NEW_DRAFT = nid(), nid(), nid()
    now_us = int(time.time() * 1e6)
    now_s = int(time.time())

    for dp, dn, fn in os.walk(DST):
        for f in fn:
            p = os.path.join(dp, f)
            if os.path.getsize(p) > 5 * 1024 * 1024:
                continue
            try:
                s = open(p, encoding='utf-8').read()
            except Exception:
                continue
            t = (s.replace(OLD_TL, NEW_TL).replace(OLD_PROJ, NEW_PROJ).replace(OLD_DRAFT, NEW_DRAFT)
                  .replace('/com.lveditor.draft/' + a.base, '/com.lveditor.draft/' + a.name))
            if t != s:
                open(p, 'w', encoding='utf-8').write(t)
    os.rename(DST + '/Timelines/' + OLD_TL, DST + '/Timelines/' + NEW_TL)
    TL = DST + '/Timelines/' + NEW_TL

    d = json.load(open(TL + '/draft_info.json'))
    m = d['materials']
    tmpl_v = m['videos'][0]
    helper_keys = ['speeds', 'placeholder_infos', 'canvases', 'sound_channel_mappings', 'material_colors', 'vocal_separations']
    tmpl_h = {k: m[k][0] for k in helper_keys}
    track = d['tracks'][0]
    tmpl_seg = track['segments'][0]
    for k in ['videos'] + helper_keys:
        m[k] = []
    segs, store_children, lib_entries = [], [], []
    total_frames = 0
    total_size = 0
    for name in names:
        info = meta[name]
        path = VDIR + '/' + name
        dur = info['duration']
        nf = int(dur * FPS + 1e-6)             # floor to whole frames so we never exceed the file
        seg_dur = int(round(nf * 1e6 / FPS))
        start = int(round(total_frames * 1e6 / FPS))
        total_frames += nf
        total_size += info['size']

        local_id = str(uuid.uuid4())
        v = copy.deepcopy(tmpl_v)
        v['id'] = nid()
        v['unique_id'] = uuid.uuid4().hex
        v['duration'] = int(round(dur * 1e6))
        v['path'] = path
        v['material_name'] = name
        v['width'] = info['width']
        v['height'] = info['height']
        v['has_audio'] = bool(info['has_audio'])
        v['local_material_id'] = local_id
        m['videos'].append(v)

        refs = []
        for k in helper_keys:
            h = copy.deepcopy(tmpl_h[k])
            h['id'] = nid()
            m[k].append(h)
            refs.append(h['id'])

        s = copy.deepcopy(tmpl_seg)
        s['id'] = nid()
        s['source_timerange'] = {'start': 0, 'duration': seg_dur}
        s['target_timerange'] = {'start': start, 'duration': seg_dur}
        s['material_id'] = v['id']
        s['extra_material_refs'] = refs
        segs.append(s)

        store_children.append({'child_id': local_id, 'parent_id': ''})
        mt = int(os.path.getmtime(path))
        md = int(dur * 1000) * 1000
        lib_entries.append({
            'ai_group_type': '', 'create_time': mt, 'duration': md, 'enter_from': 0, 'extra_info': name,
            'file_Path': path, 'height': info['height'], 'id': local_id, 'import_time': now_s,
            'import_time_ms': now_us, 'item_source': 1, 'md5': '', 'metetype': 'video',
            'roughcut_time_range': {'duration': md, 'start': 0}, 'sub_time_range': {'duration': -1, 'start': -1},
            'type': 0, 'width': info['width']})

    total_us = int(round(total_frames * 1e6 / FPS))
    track['segments'] = segs
    track['id'] = nid()
    d['id'] = NEW_TL
    d['duration'] = total_us

    blob = dump(d)
    for p in [TL + '/draft_info.json', TL + '/draft_info.json.bak', TL + '/template-2.tmp',
              DST + '/draft_info.json', DST + '/draft_info.json.bak', DST + '/template-2.tmp']:
        open(p, 'w', encoding='utf-8').write(blob)

    pj = json.load(open(DST + '/Timelines/project.json'))
    pj['create_time'] = pj['update_time'] = now_us
    for t in pj['timelines']:
        t['create_time'] = t['update_time'] = now_us
    open(DST + '/Timelines/project.json', 'w', encoding='utf-8').write(dump(pj))
    shutil.copy(DST + '/Timelines/project.json', DST + '/Timelines/project.json.bak')

    dm = json.load(open(DST + '/draft_meta_info.json'))
    dm['draft_id'] = NEW_DRAFT
    dm['draft_name'] = a.name
    dm['draft_fold_path'] = DST
    dm['tm_draft_create'] = dm['tm_draft_modified'] = now_us
    dm['tm_duration'] = total_us
    dm['draft_timeline_materials_size_'] = total_size
    for e in dm['draft_materials']:
        if e['type'] == 0:
            e['value'] = e['value'][:1] + lib_entries      # keep the placeholder entry, add the clips
    open(DST + '/draft_meta_info.json', 'w', encoding='utf-8').write(dump(dm))

    vs = json.load(open(DST + '/draft_virtual_store.json'))
    for e in vs['draft_virtual_store']:
        if e['type'] == 1:
            e['value'] = e['value'][:1] + store_children
    open(DST + '/draft_virtual_store.json', 'w', encoding='utf-8').write(dump(vs))
    open(DST + '/key_value.json', 'w', encoding='utf-8').write('{}')

    rp = ROOT + '/root_meta_info.json'
    bak = rp + '.bak_claude'
    if not os.path.exists(bak):
        shutil.copy(rp, bak)
    rm = json.load(open(rp))
    ent = next((copy.deepcopy(e) for e in rm['all_draft_store'] if e.get('draft_name') == a.base), None)
    assert ent is not None, 'base project not in root_meta_info.json'
    for k in list(ent):
        if isinstance(ent[k], str):
            ent[k] = ent[k].replace('/com.lveditor.draft/' + a.base, '/com.lveditor.draft/' + a.name)
    ent['draft_id'] = NEW_DRAFT
    ent['draft_name'] = a.name
    ent['draft_fold_path'] = DST
    ent['draft_json_file'] = DST + '/draft_info.json'
    ent['draft_timeline_materials_size'] = total_size
    for k in ent:
        if k in ('tm_draft_create', 'tm_draft_modified'):
            ent[k] = now_us
        if k == 'tm_duration':
            ent[k] = total_us
    rm['all_draft_store'].insert(0, ent)
    open(rp, 'w', encoding='utf-8').write(dump(rm))

    print('created', DST)
    print('clips', len(segs), 'total %.1f sec = %.1f min' % (total_us / 1e6, total_us / 6e7))


if __name__ == '__main__':
    main()
