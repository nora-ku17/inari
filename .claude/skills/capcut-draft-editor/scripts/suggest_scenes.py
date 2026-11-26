#!/usr/bin/env python3
"""Propose where to cut a project range into 4 scenes, using gaps between clip shooting times.

We cannot see the footage, so a long pause between two clips (lunch, travel, next day) is used as the
scene boundary; among those the combination of 3 boundaries giving roughly equal scene lengths wins.
Prints segment indexes to paste into split.json ("scene_starts") and the 'from'/'to' candidates
(the biggest capture gaps, i.e. natural places to split a project into separate videos).

Usage:
    python3 suggest_scenes.py --project 旅行_全クリップ --ranges 0:66 66:
"""
import argparse, json, glob, os, itertools, math, re, datetime

DEFAULT_ROOT = '~/Movies/CapCut/User Data/Projects/com.lveditor.draft'


def clip_time(name):
    m = re.search(r'(\d{8})_(\d{6})', name)
    return datetime.datetime.strptime(m.group(1) + m.group(2), '%Y%m%d%H%M%S')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=DEFAULT_ROOT)
    ap.add_argument('--project', required=True)
    ap.add_argument('--ranges', nargs='+', required=True, help='lo:hi segment ranges, hi empty = end')
    ap.add_argument('--scenes', type=int, default=4)
    ap.add_argument('--min-gap-min', type=float, default=10)
    a = ap.parse_args()
    base = os.path.expanduser(a.root) + '/' + a.project
    d = json.load(open(glob.glob(base + '/Timelines/*/draft_info.json')[0]))
    vid = {v['id']: v for v in d['materials']['videos']}
    segs = d['tracks'][0]['segments']
    info = [(s['target_timerange']['start'] / 1e6, s['target_timerange']['duration'] / 1e6,
             clip_time(vid[s['material_id']]['material_name'])) for s in segs]

    gaps = sorted(((info[i][2] - info[i - 1][2]).total_seconds() / 60, i, info[i][0]) for i in range(1, len(info)))
    print('biggest gaps (min | seg idx | timeline mm:ss):')
    for g, i, t in reversed(gaps[-10:]):
        print('  %5.0f | %3d | %d:%02d' % (g, i, t // 60, t % 60))

    for r in a.ranges:
        lo_s, hi_s = r.split(':')
        lo = int(lo_s or 0)
        hi = int(hi_s) if hi_s else len(info)
        t0 = info[lo][0]
        t1 = info[hi - 1][0] + info[hi - 1][1]
        L = t1 - t0
        cand = [(i, (info[i][2] - info[i - 1][2]).total_seconds() / 60) for i in range(lo + 1, hi)]
        best = None
        for c in itertools.combinations([x for x in cand if x[1] >= a.min_gap_min], a.scenes - 1):
            b = [t0] + [info[i][0] for i, _ in c] + [t1]
            ls = [b[k + 1] - b[k] for k in range(a.scenes)]
            if min(ls) < L * 0.12:
                continue
            score = sum((l / (L / a.scenes) - 1) ** 2 for l in ls) - 0.35 * sum(math.log(g) for _, g in c)
            if best is None or score < best[0]:
                best = (score, c, ls)
        print('\nrange %s  (%.0fs)' % (r, L))
        if best is None:
            print('  no good split found (too few big gaps) - choose by hand')
            continue
        print('  "scene_starts": %s' % [i for i, _ in best[1]])
        print('  scene lengths (s): %s' % [round(x) for x in best[2]])


if __name__ == '__main__':
    main()
