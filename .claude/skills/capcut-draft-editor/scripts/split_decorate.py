#!/usr/bin/env python3
"""Split a CapCut project's single video track into one or more NEW projects and decorate each one
with a typewriter title, a typing sound effect and BGM (one song per scene, looped if the scene is
longer than the song), copying the look from a template project that already uses them.
With a single half covering the whole timeline this just decorates one project (original untouched).

Usage:
    python3 split_decorate.py --config split.json [--root <draft root>]

split.json:
{
  "source":   "旅行_全クリップ",          // project holding the cut timeline (not modified)
  "template": "0721-コピー",              // project whose title/typing animation/BGM we copy
  "songs":    ["fresh start", "3：30PM",  // one entry per scene. A string = a song of the template.
               {"name": "VLOG いつもの生活と優しい歌♪", "from": "1127"},   // = a song of another project ("source" = the source project itself)
               "coffee time"],
  "halves": [
    {"name": "旅行_前半", "from": 0,  "to": 66,   "scene_starts": [9, 34, 50],
     "title": "2026年8月23日〜24日\\n福井旅行 前編"},
    {"name": "1127_仕上げ", "from": 0, "to": null, "scene_starts": [6, 13, 26],
     "title": "...",
     "intro": {"from": "1127", "name": "10秒　軽やかで可愛いフルートのジングル"},   // put this jingle of another project at 0:00 (implies after_intro)
     "keep_source_audio": true,                      // OR keep what is already on the source's audio tracks (e.g. an intro jingle)
     "drop_audio_names": ["VLOG いつもの生活と優しい歌♪"],   // ...except these (they are re-placed as scene BGM)
     "after_intro": true}                            // scene-1 BGM starts when the kept intro ends; the title is placed per "title_mode"
  ]
}
Opening / title placement ("title_mode", per half):
  "start"               title + typing sound at 0:00 (default when there is no intro).
  "after_intro"         title starts when the kept intro ends (the first design).
  "end_at_first_clip"   (default when "after_intro" is true) the title ends exactly where the first clip ends and
                        lasts "title_dur_s" (default 5.767 s), so it overlays the last seconds of clip 1 and the
                        intro jingle; the typing sound starts with it, louder ("title_sfx_volume", default 1.477).
                        add_labels.py then starts the first label right when the title ends. This is the user's
                        own hand-tuned opening of the 1127 project.
"from"/"to" are indexes into the video track's segments (to is exclusive, null = to the end).
"scene_starts" are the 3 segment indexes (absolute, same numbering as from/to) where scenes 2..4 begin;
use suggest_scenes.py to propose them. keep_source_audio needs "from": 0. Quit CapCut before running.
"""
import argparse, json, os, shutil, uuid, time, copy, glob

DEFAULT_ROOT = '~/Movies/CapCut/User Data/Projects/com.lveditor.draft'
FADE_EDGE = 1500000   # fade-out at the end of a scene (us)
FADE_JOIN = 500000    # fade at loop joins inside a scene (us)


def nid():
    return str(uuid.uuid4()).upper()


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))


def tl_file(base):
    fs = glob.glob(base + '/Timelines/*/draft_info.json')
    assert len(fs) == 1, fs
    return fs[0]


def index_materials(d):
    out = {}
    for k, v in d['materials'].items():
        if isinstance(v, list):
            for e in v:
                if isinstance(e, dict) and 'id' in e:
                    out[e['id']] = (k, e)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=DEFAULT_ROOT)
    ap.add_argument('--config', required=True)
    args = ap.parse_args()
    ROOT = os.path.expanduser(args.root)
    cfg = json.load(open(args.config))
    SRC_NAME, TPL_NAME = cfg['source'], cfg['template']
    SRC, TPL = ROOT + '/' + SRC_NAME, ROOT + '/' + TPL_NAME
    song_specs = [(s, 'tpl') if isinstance(s, str) else (s['name'], s.get('from', 'tpl')) for s in cfg['songs']]

    # ---- source (read-only) ----
    src_meta = json.load(open(SRC + '/draft_meta_info.json'))
    src_proj = json.load(open(SRC + '/Timelines/project.json'))
    OLD_TL, OLD_PROJ, OLD_DRAFT = src_proj['main_timeline_id'], src_proj['id'], src_meta['draft_id']
    src_d = json.load(open(tl_file(SRC)))
    src_all = index_materials(src_d)
    all_segs = src_d['tracks'][0]['segments']
    assert src_d['tracks'][0]['type'] == 'video', 'first source track must be the video track'
    src_audio_tracks = [t for t in src_d['tracks'][1:] if t['type'] == 'audio' and t['segments']]
    assert all(t['type'] in ('audio',) or not t['segments'] for t in src_d['tracks'][1:]), \
        'source has text/other tracks; only a video track (+ audio with keep_source_audio) is supported: %s' % \
        [t['type'] for t in src_d['tracks']]

    # ---- template (read-only) ----
    tpl = json.load(open(tl_file(TPL)))
    tpl_all = index_materials(tpl)
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
            if a['name'] not in tpl_song_seg:
                tpl_song_seg[a['name']] = s
            if a['type'] == 'sound' and 'タイピング' in a['name'] and tpl_sfx_seg is None:
                tpl_sfx_seg = s
    assert tpl_sfx_seg is not None, 'no typing sound effect in template'
    assert os.path.exists(tpl_all[tpl_sfx_seg['material_id']][1]['path'])

    proj_cache = {}

    def find_audio(pname, name):
        """first audio segment called `name` in project `pname` -> (segment, material map of that project)"""
        if pname not in proj_cache:
            dd = json.load(open(tl_file(ROOT + '/' + pname)))
            proj_cache[pname] = (index_materials(dd), [s for t in dd['tracks'] if t['type'] == 'audio' for s in t['segments']])
        am, segs_ = proj_cache[pname]
        seg = next((x for x in segs_ if am[x['material_id']][1]['name'] == name), None)
        assert seg is not None, 'audio %r not found in project %r' % (name, pname)
        return seg, am

    # song name -> (segment to copy from, material map that segment's ids live in)
    song_src = {}
    for name, origin in song_specs:
        if origin != 'tpl':
            song_src[name] = find_audio(SRC_NAME if origin == 'source' else origin, name)
        else:
            assert name in tpl_song_seg, 'song %r not found in template' % name
            song_src[name] = (tpl_song_seg[name], tpl_all)
        p = song_src[name][1][song_src[name][0]['material_id']][1]['path']
        assert os.path.exists(p), 'missing song file ' + p      # only songs cached on this Mac can be reused
    SONGS = [n for n, _ in song_specs]
    song_vol = {n: song_src[n][0]['volume'] for n in SONGS}      # keep the original mix

    def add_audio_segment(d, track, amap, tseg, start, src_start, dur, volume, fade_in, fade_out):
        m = d['materials']
        a = copy.deepcopy(amap[tseg['material_id']][1])
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
            k, e = amap[r]
            h = copy.deepcopy(e)
            h['id'] = nid()
            if k == 'audio_fades':
                h['fade_in_duration'] = fade_in
                h['fade_out_duration'] = fade_out
            m.setdefault(k, []).append(h)
            refs.append(h['id'])
        s['extra_material_refs'] = refs
        track['segments'].append(s)

    summary = []
    for h in cfg['halves']:
        name, lo, hi = h['name'], h['from'], h['to']
        scene_idx, title = h['scene_starts'], h['title']
        keep_audio = h.get('keep_source_audio', False)
        drop_names = set(h.get('drop_audio_names', []))
        hi = len(all_segs) if hi is None else hi
        if src_audio_tracks and not keep_audio:
            raise SystemExit('source has audio tracks: set "keep_source_audio": true (and list "drop_audio_names") for %s' % name)
        assert not keep_audio or lo == 0, 'keep_source_audio needs "from": 0'
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

        # source audio that stays (e.g. an intro jingle)
        d_all = index_materials(d)
        kept_audio_tracks = []
        intro_end = 0
        if keep_audio:
            for t in d['tracks'][1:]:
                if t['type'] != 'audio':
                    continue
                segs_ = [s for s in t['segments'] if d_all[s['material_id']][1]['name'] not in drop_names]
                if segs_:
                    t['segments'] = segs_
                    kept_audio_tracks.append(t)
                    for s in segs_:
                        if s['target_timerange']['start'] == 0:
                            intro_end = max(intro_end, s['target_timerange']['duration'])
        intro_cfg = h.get('intro')
        if intro_cfg:                      # a jingle taken from another project, placed at 0:00
            tseg, amap = find_audio(SRC_NAME if intro_cfg['from'] == 'source' else intro_cfg['from'], intro_cfg['name'])
            assert os.path.exists(amap[tseg['material_id']][1]['path']), 'missing intro file'
            introtrack = copy.deepcopy(tpl_audio_tracks[0])
            introtrack['id'] = nid()
            introtrack['segments'] = []
            idur = tseg['target_timerange']['duration']
            add_audio_segment(d, introtrack, amap, tseg, 0, tseg['source_timerange']['start'], idur, tseg['volume'], 0, 0)
            kept_audio_tracks.append(introtrack)
            intro_end = max(intro_end, idur)
        after_intro = h.get('after_intro') or bool(intro_cfg)
        bgm_start = intro_end if after_intro else 0
        title_mode = h.get('title_mode', 'end_at_first_clip' if after_intro else 'start')
        t_dur, sfx_vol = title_dur, 1.0
        if title_mode == 'end_at_first_clip':
            t_dur = int(round(h.get('title_dur_s', 5.766667) * 1e6))
            t_end = max(keep[0]['target_timerange']['duration'], t_dur)
            t_start = t_end - t_dur
            sfx_vol = h.get('title_sfx_volume', 1.477370023727417)
        elif title_mode == 'after_intro':
            t_start = intro_end
        else:
            t_start = 0

        # prune materials to what the kept segments reference
        refset = set()
        for s in keep + [s for t in kept_audio_tracks for s in t['segments']]:
            refset.add(s['material_id'])
            refset.update(s['extra_material_refs'])
        m = d['materials']
        for k, v in list(m.items()):
            if isinstance(v, list) and v and all(isinstance(e, dict) and 'id' in e for e in v):
                m[k] = [e for e in v if e['id'] in refset]
        kept_videos = m['videos']

        starts = [keep[i - lo]['target_timerange']['start'] for i in scene_idx]
        bounds = [bgm_start] + starts + [total]

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
        ts['target_timerange'] = {'start': t_start, 'duration': t_dur}
        ttrack = copy.deepcopy(tpl_text_tracks[0])
        ttrack['id'] = nid()
        ttrack['segments'] = [ts]

        # BGM: one song per scene, repeated from the start if the scene is longer than the song
        songtrack = copy.deepcopy(tpl_audio_tracks[0])
        songtrack['id'] = nid()
        songtrack['segments'] = []
        for i, song in enumerate(SONGS):
            tseg, amap = song_src[song]
            a_dur = amap[tseg['material_id']][1]['duration']
            pos, end = bounds[i], bounds[i + 1]
            first = True
            while pos < end:
                dur = min(a_dur, end - pos)
                last = (pos + dur >= end)
                add_audio_segment(d, songtrack, amap, tseg, pos, 0, dur, song_vol[song],
                                  FADE_EDGE if first and i > 0 else (FADE_JOIN if not first else 0),
                                  FADE_EDGE if last else FADE_JOIN)
                pos += dur
                first = False
        # typing sfx under the title
        sfxtrack = copy.deepcopy(tpl_audio_tracks[-1])
        sfxtrack['id'] = nid()
        sfxtrack['segments'] = []
        add_audio_segment(d, sfxtrack, tpl_all, tpl_sfx_seg, t_start, 0,
                          tpl_sfx_seg['target_timerange']['duration'], sfx_vol, 0, 0)

        d['tracks'] = [vtrack, ttrack] + kept_audio_tracks + [songtrack, sfxtrack]
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
