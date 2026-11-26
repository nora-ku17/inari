#!/usr/bin/env python3
"""Measure duration / resolution / audio presence of every clip in a folder, without ffmpeg.

Reads the MP4/MOV 'moov' header directly. iCloud-offloaded ("dataless") files are
downloaded first with `brctl download` (reading them directly just times out).
Files are LEFT downloaded so CapCut can use them afterwards.

Usage (run on the Mac that has the clips):
    python3 measure_clips.py --dir ~/Desktop/trip --out /tmp/clips_meta.json
Resumable: clips already present in --out are skipped.
"""
import argparse, struct, glob, os, json, subprocess, time, shutil


def boxes(data, off, end):
    while off + 8 <= end:
        sz, t = struct.unpack('>I4s', data[off:off + 8])
        hs = 8
        if sz == 1:
            sz = struct.unpack('>Q', data[off + 8:off + 16])[0]
            hs = 16
        elif sz == 0:
            sz = end - off
        if sz < hs:
            return
        yield t, off + hs, off + sz
        off += sz


def parse_moov(p):
    with open(p, 'rb') as f:
        end = os.fstat(f.fileno()).st_size
        pos = 0
        data = None
        while pos < end:
            f.seek(pos)
            h = f.read(8)
            if len(h) < 8:
                break
            sz, t = struct.unpack('>I4s', h)
            hs = 8
            if sz == 1:
                sz = struct.unpack('>Q', f.read(8))[0]
                hs = 16
            elif sz == 0:
                sz = end - pos
            if t == b'moov':
                f.seek(pos + hs)
                data = f.read(sz - hs)
                break
            pos += sz
    if data is None:
        return None
    info = {'duration': None, 'width': None, 'height': None, 'has_audio': False}
    for t, s, e in boxes(data, 0, len(data)):
        if t == b'mvhd':
            v = data[s]
            if v == 0:
                ts, du = struct.unpack('>II', data[s + 12:s + 20])
            else:
                ts, du = struct.unpack('>IQ', data[s + 20:s + 32])
            info['duration'] = du / ts
        elif t == b'trak':
            kind = None
            w = h = None
            for t2, s2, e2 in boxes(data, s, e):
                if t2 == b'tkhd':
                    v = data[s2]
                    o = s2 + (76 if v == 0 else 88)
                    w, h = struct.unpack('>II', data[o:o + 8])
                    w >>= 16
                    h >>= 16
                elif t2 == b'mdia':
                    for t3, s3, e3 in boxes(data, s2, e2):
                        if t3 == b'hdlr':
                            kind = data[s3 + 8:s3 + 12]
            if kind == b'vide' and info['width'] is None:
                info['width'], info['height'] = w, h
            if kind == b'soun':
                info['has_audio'] = True
    return info


def is_dataless(p):
    out = subprocess.run(['ls', '-lO', p], capture_output=True, text=True).stdout
    return 'dataless' in out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--ext', default='mp4,mov', help='comma separated extensions')
    ap.add_argument('--min-free-gb', type=float, default=6.0, help='stop if free disk drops below this')
    ap.add_argument('--timeout-min', type=float, default=20.0, help='per-file download timeout')
    a = ap.parse_args()
    d = os.path.expanduser(a.dir)
    out = os.path.expanduser(a.out)
    meta = json.load(open(out)) if os.path.exists(out) else {}
    files = []
    for e in a.ext.split(','):
        files += glob.glob(os.path.join(d, '*.' + e)) + glob.glob(os.path.join(d, '*.' + e.upper()))
    files = sorted(set(files))
    print('start: %d files, %d already measured' % (len(files), len(meta)), flush=True)
    for p in files:
        name = os.path.basename(p)
        if name in meta:
            continue
        was_off = is_dataless(p)
        try:
            if was_off:
                free = shutil.disk_usage('/').free
                if free < a.min_free_gb * 1024 ** 3:
                    print('STOP low disk: %.1f GB free' % (free / 1e9), flush=True)
                    break
                subprocess.run(['brctl', 'download', p], capture_output=True)
                t0 = time.time()
                while is_dataless(p):
                    if time.time() - t0 > a.timeout_min * 60:
                        raise TimeoutError('download timeout')
                    time.sleep(3)
            info = parse_moov(p)
            info['size'] = os.path.getsize(p)
            info['was_offloaded'] = was_off
            meta[name] = info
            json.dump(meta, open(out, 'w'), ensure_ascii=False)
            print('OK %s %.1fs %sx%s audio=%s offloaded=%s' % (
                name, info['duration'], info['width'], info['height'], info['has_audio'], was_off), flush=True)
        except Exception as ex:
            print('ERR %s %r' % (name, ex), flush=True)
    print('finished: %d/%d' % (len(meta), len(files)), flush=True)


if __name__ == '__main__':
    main()
