#!/usr/bin/env python3
"""Split a CapCut project's single video track into several NEW projects and decorate each one
with a typewriter title, a typing sound effect and BGM (one song per scene, looped if the scene is
longer than the song), copying the look from a template project that already uses them.

Usage:
    python3 split_decorate.py --config split.json [--root <draft root>]

split.json:
{
  "source":   "旅行_全クリップ",          // project holding the cut timeline (not modified)
  "template": "0721-コピー",              // project whose title/typing animation/BGM we copy
  "songs":    ["fresh start", "3：30PM", "Honey Tea", "coffee time"],   // names as in the template
  "halves": [
    {"name": "旅行_前半", "from": 0,  "to": 66,   "scene_starts": [9, 34, 50],
     "title": "2026年8月23日〜24日\\n福井旅行 前編"},
    {"name": "旅行_後半", "from": 66, "to": null, "scene_starts": [83, 88, 95],
     "title": "..."}
  ]
}
"from"/"to" are indexes into the video track's segments (to is exclusive, null = to the end).
"scene_starts" are the 3 segment indexes (absolute, same numbering as from/to) where scenes 2..4 begin;
use suggest_scenes.py to propose them. Quit CapCut before running.
"""
import argparse, json, os, shutil, uuid, time, copy, glob

DEFAULT_ROOT = '~/Movies/CapCut/User Data/Projects/com.lveditor.draft'
FPS_US = 1e6
FADE_EDGE = 1500000   # fade-out at the end of a scene (us)
FADE_JOIN = 500000    # fade at loop joins inside a scene (us)
TITLE_START = 0


def nid():
    return str(uuid.uuid4()).upper()


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))


def tl_file(base):
    fs = glob.glob(base + '/Timelines/*/draft_info.json')
    assert len(fs) == 1, fs
    return fs[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=DEFAULT_ROOT)
    ap.add_argument('--config', required=True)
    args = ap.parse_args()
    ROOT = os.path.expanduser(args.root)
    cfg = json.load(open(args.config))
    SRC_NAME, TPL_NAME, SONGS = cfg['source'], cfg['template'], cfg['songs']
    SRC, TPL = ROOT + '/' + SRC_NAME, ROOT + '/' + TPL_NAME

    # ---- template (read-only) ----
    tpl = json.load(open(tl_file(TPL)))
    tpl_all = {}
    for k, v in tpl['materials'].items():
        if isinstance(v, list):
            for e in v:
                if isinstance(e, dict) and 'id' in e:
                    tpl_all[e['id']] = (k, e)
    tpl_audio_tracks = [t for t in tpl['tracks'] if t['type'] == 'audio']
    tpl_text_tracks = [t for t in tpl['tracks'] if t['type'] == 'text']
    tpl_title_seg = tpl_text_tracks[0]['segments'][0]
    tpl_title_text = tpl_all[tpl_title_seg['material_id']][1]
    tpl_title_anim = tpl_all[tpl_title_seg['extra_material_refs'][0]][1]
    assert tpl_title_anim['animations'][0]['name'] == 'タイプ', 'first text of template must use the タイプ animation'
    title_dur = tpl_title_seg['target_timerange']['duration']
    tpl_song_seg, tpl_sfx_seg = {}, None
    for t in tpl_audio_tracks:
        for s in t['segments']:
            a = tpl_all[s['material_id']][1]
            if a['name'] in SONGS and a['name'] not in tpl_song_seg:
                tpl_song_seg[a['name']] = s
            if a['type'] == 'sound' and 'タイピング' in a['name'] and tpl_sfx_seg is None:
                tpl_sfx_seg = s
    assert set(tpl_song_seg) == set(SONGS), 'songs not found in template: %s' % (set(SONGS) - set(tpl_song_seg))
    assert tpl_sfx_seg is not None, 'no typing sound effect in template'
    for n in SONGS:      # only songs CapCut has cached on this Mac can be reused
        p = tpl_all[tpl_song_seg[n]['material_id']][1]['path']
        assert os.path.exists(p), 'missing song file ' + p
    assert os.path.exists(tpl_all[tpl_sfx_seg['material_id']][1]['path'])
    song_vol = {n: tpl_song_seg[n]['volume'] for n in SONGS}      # keep the template's mix

    def add_audio_segment(d, track, tseg, start, src_start, dur, volume, fade_in, fade_out):
        m = d['materials']
        a = copy.deepcopy(tpl_all[tseg['material_id']][1])
        a['id'] = nid()
        m.setdefault('audios', []).append(a)
        s = copy.deepcopy(tseg)
        s['id'] = nid()
        s['material_id'] = a['id']
        s['source_timerange'] = {'start': src_start, 'duration': dur}
        s['target_timerange'] = {'start': start, 'duration': dur}
        s['volume'] = volume
        s['last_nonzero_volume'] = volume
        refs = []
        for r in tseg['extra_material_refs']:
            k, e = tpl_all[r]
            h = copy.deepcopy(e)
            h['id'] = nid()
            if k == 'audio_fades':
                h['fade_in_duration'] = fade_in
                h['fade_out_duration'] = fade_out
            m.setdefault(k, []).append(h)
            refs.append(h['id'])
        s['extra_material_refs'] = refs
        track['segments'].append(s)

    src_meta = json.load(open(SRC + '/draft_meta_info.json'))
    src_proj = json.load(open(SRC + '/Timelines/project.json'))
    OLD_TL, OLD_PROJ, OLD_DRAFT = src_proj['main_timeline_id'], src_proj['id'], src_meta['draft_id']
    src_d = json.load(open(tl_file(SRC)))
    all_segs = src_d['tracks'][0]['segments']
    assert src_d['tracks'][0]['type'] == 'video' and len(src_d['tracks']) == 1, \
        'source must contain only one video track (found %s)' % [t['type'] for t in src_d['tracks']]

    summary = []
    for h in cfg['halves']:
        name, lo, hi = h['name'], h['from'], h['to']
        scene_idx, title = h['scene_starts'], h['title']
        hi = len(all_segs) if hi is None else hi
        DST = ROOT + '/' + name
        assert not os.path.exists(DST), 'already exists: ' + DST
        shutil.copytree(SRC, DST)
        NEW_TL, NEW_PROJ, NEW_DRAFT = nid(), nid(), nid()
        now_us = int(time.time() * 1e6)

        for dp, dn, fn in os.walk(DST):
            for f in fn:
                p = os.path.join(dp, f)
                if os.path.getsize(p) > 20 * 1024 * 1024:
                    continue
                try:
                    s_ = open(p, encoding='utf-8').read()
                except Exception:
                    continue
                t_ = (s_.replace(OLD_TL, NEW_TL).replace(OLD_PROJ, NEW_PROJ).replace(OLD_DRAFT, NEW_DRAFT)
                      .replace('/com.lveditor.draft/' + SRC_NAME, '/com.lveditor.draft/' + name))
                if t_ != s_:
                    open(p, 'w', encoding='utf-8').write(t_)
        os.rename(DST + '/Timelines/' + OLD_TL, DST + '/Timelines/' + NEW_TL)
        TL = DST + '/Timelines/' + NEW_TL

        d = json.load(open(TL + '/draft_info.json'))
        vtrack = d['tracks'][0]
        keep = copy.deepcopy(vtrack['segments'][lo:hi])
        offset = keep[0]['target_timerange']['start']
        for s in keep:
            s['target_timerange']['start'] -= offset
        vtrack['segments'] = keep
        total = keep[-1]['target_timerange']['start'] + keep[-1]['target_timerange']['duration']

        # prune materials to what the kept segments reference
        refset = set()
        for s in keep:
            refset.add(s['material_id'])
            refset.update(s['extra_material_refs'])
        m = d['materials']
        for k, v in list(m.items()):
            if isinstance(v, list) and v and all(isinstance(e, dict) and 'id' in e for e in v):
                m[k] = [e for e in v if e['id'] in refset]
        kept_videos = m['videos']

        starts = [keep[i - lo]['target_timerange']['start'] for i in scene_idx]
        bounds = [0] + starts + [total]

        # title (typewriter)
        txt = copy.deepcopy(tpl_title_text)
        txt['id'] = nid()
        c = json.loads(txt['content'])
        c['text'] = title
        for st in c['styles']:
            st['range'] = [0, len(title)]
        txt['content'] = json.dumps(c, ensure_ascii=False, separators=(',', ':'))
        m.setdefault('texts', []).append(txt)
        anim = copy.deepcopy(tpl_title_anim)
        anim['id'] = nid()
        m.setdefault('material_animations', []).append(anim)
        ts = copy.deepcopy(tpl_title_seg)
        ts['id'] = nid()
        ts['material_id'] = txt['id']
        ts['extra_material_refs'] = [anim['id']]
        ts['target_timerange'] = {'start': TITLE_START, 'duration': title_dur}
        ttrack = copy.deepcopy(tpl_text_tracks[0])
        ttrack['id'] = nid()
        ttrack['segments'] = [ts]

        # BGM: one song per scene, repeated from the start if the scene is longer than the song
        songtrack = copy.deepcopy(tpl_audio_tracks[0])
        songtrack['id'] = nid()
        songtrack['segments'] = []
        for i, song in enumerate(SONGS):
            a_dur = tpl_all[tpl_song_seg[song]['material_id']][1]['duration']
            pos, end = bounds[i], bounds[i + 1]
            first = True
            while pos < end:
                dur = min(a_dur, end - pos)
                last = (pos + dur >= end)
                add_audio_segment(d, songtrack, tpl_song_seg[song], pos, 0, dur, song_vol[song],
                                  FADE_EDGE if first and i > 0 else (FADE_JOIN if not first else 0),
                                  FADE_EDGE if last else FADE_JOIN)
                pos += dur
                first = False
        # typing sfx under the title
        sfxtrack = copy.deepcopy(tpl_audio_tracks[-1])
        sfxtrack['id'] = nid()
        sfxtrack['segments'] = []
        add_audio_segment(d, sfxtrack, tpl_sfx_seg, TITLE_START, 0,
                          tpl_sfx_seg['target_timerange']['duration'], 1.0, 0, 0)

        d['tracks'] = [vtrack, ttrack, songtrack, sfxtrack]
        d['id'] = NEW_TL
        d['duration'] = total
        blob = dump(d)
        for p in [TL + '/draft_info.json', TL + '/draft_info.json.bak', TL + '/template-2.tmp',
                  DST + '/draft_info.json', DST + '/draft_info.json.bak', DST + '/template-2.tmp']:
            if os.path.exists(p) or p.endswith('draft_info.json'):
                open(p, 'w', encoding='utf-8').write(blob)

        pj = json.load(open(DST + '/Timelines/project.json'))
        pj['create_time'] = pj['update_time'] = now_us
        for t in pj['timelines']:
            t['create_time'] = t['update_time'] = now_us
        open(DST + '/Timelines/project.json', 'w', encoding='utf-8').write(dump(pj))
        shutil.copy(DST + '/Timelines/project.json', DST + '/Timelines/project.json.bak')

        keep_local = {v['local_material_id'] for v in kept_videos}
        removed_local = {v['local_material_id'] for v in src_d['materials']['videos']} - keep_local
        total_size = sum(os.path.getsize(v['path']) for v in kept_videos)
        dm = json.load(open(DST + '/draft_meta_info.json'))
        dm['draft_id'] = NEW_DRAFT
        dm['draft_name'] = name
        dm['draft_fold_path'] = DST
        dm['tm_draft_create'] = dm['tm_draft_modified'] = now_us
        dm['tm_duration'] = total
        dm['draft_timeline_materials_size_'] = total_size
        for e in dm['draft_materials']:
            if e['type'] == 0:
                e['value'] = [x for x in e['value'] if x.get('id') not in removed_local]
        open(DST + '/draft_meta_info.json', 'w', encoding='utf-8').write(dump(dm))

        vs = json.load(open(DST + '/draft_virtual_store.json'))
        for e in vs['draft_virtual_store']:
            if e['type'] == 1:
                e['value'] = [x for x in e['value'] if x['child_id'] not in removed_local]
        open(DST + '/draft_virtual_store.json', 'w', encoding='utf-8').write(dump(vs))
        open(DST + '/key_value.json', 'w', encoding='utf-8').write('{}')

        rp = ROOT + '/root_meta_info.json'
        bak = rp + '.bak_claude2'
        if not os.path.exists(bak):
            shutil.copy(rp, bak)
        rm = json.load(open(rp))
        ent = next(copy.deepcopy(e) for e in rm['all_draft_store'] if e.get('draft_name') == SRC_NAME)
        for k in list(ent):
            if isinstance(ent[k], str):
                ent[k] = ent[k].replace('/com.lveditor.draft/' + SRC_NAME, '/com.lveditor.draft/' + name)
        ent['draft_id'] = NEW_DRAFT
        ent['draft_name'] = name
        ent['draft_fold_path'] = DST
        ent['draft_json_file'] = DST + '/draft_info.json'
        ent['draft_timeline_materials_size'] = total_size
        for k in ent:
            if k in ('tm_draft_create', 'tm_draft_modified'):
                ent[k] = now_us
            if k == 'tm_duration':
                ent[k] = total
        rm['all_draft_store'].insert(0, ent)
        open(rp, 'w', encoding='utf-8').write(dump(rm))

        summary.append((name, len(keep), total / 1e6, [round(x / 1e6) for x in bounds]))

    for s in summary:
        print('created %s: %d clips, %.1f sec (%.1f min), scene bounds(s)=%s' % (s[0], s[1], s[2], s[2] / 60, s[3]))


if __name__ == '__main__':
    main()
