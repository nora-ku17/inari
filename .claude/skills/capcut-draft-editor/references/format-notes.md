# CapCut ドラフト形式メモ(CapCut 8.9.0 / macOS で確認)

## ディレクトリ
```
com.lveditor.draft/
  root_meta_info.json           プロジェクト一覧(all_draft_store に1件ずつ)。書く前に .bak を取る
  <プロジェクト名>/
    draft_info.json             タイムライン本体(平文JSON)。Timelines/<ID>/draft_info.json と同内容
    draft_info.json.bak / template-2.tmp   同内容のコピー。揃えて書く
    draft_meta_info.json        プロジェクト名・draft_id・素材ライブラリ(draft_materials type 0)
    draft_virtual_store.json    素材ライブラリの子ID(type 1 の child_id = 素材の local_material_id)
    key_value.json              UI用メタ。空 {} で問題なし
    timeline_layout.json / draft_biz_config.json / Timelines/project.json  タイムラインIDを含む
    Timelines/<タイムラインID>/draft_info.json
```
- 新規プロジェクトは **既存プロジェクトをフォルダごとコピーして**、プロジェクトID(`Timelines/project.json` の `id`)、タイムラインID(`main_timeline_id`、フォルダ名も)、`draft_meta_info.json` の `draft_id` を新しいUUIDへ全テキストファイルで置換する。スキーマをゼロから書くより安全。
- `root_meta_info.json` には元プロジェクトのエントリをコピーして `draft_id / draft_name / draft_fold_path / draft_json_file / draft_timeline_materials_size / tm_*` を直して追加する。CapCutが起動中だと並び順を書き換えて末尾に回すことがある(登録自体は残った)。

## draft_info.json
- 時間は **マイクロ秒**、fps 30。セグメントの長さはフレーム境界(`round(frames*1e6/30)`)にし、実ファイルの長さを超えない(floor)。
- `tracks[]`: `video` / `text` / `audio`。下から上の順。`segments[]` は `target_timerange`(タイムライン上)と `source_timerange`(素材内)を持つ。
- セグメントは `material_id`(`materials.videos|audios|texts` のid)と `extra_material_refs`(補助素材のid列)を持つ。
  - 動画: `speeds, placeholder_infos, canvases, sound_channel_mappings, material_colors, vocal_separations` を **1セグメントにつき1セット**、新しいidで複製。
  - 音声: `speeds, placeholder_infos, audio_fades, beats, sound_channel_mappings, vocal_separations`。フェードは `audio_fades` の `fade_in_duration / fade_out_duration`。
  - テキスト: アニメーション素材 `material_animations`(`animations[0].name == 'タイプ'` がタイプライター。`path` はCapCutのエフェクトキャッシュを指すので見本からコピーする)。
- **参照されない素材は残さない**(分割時は参照されているidだけに絞る)。
- 見た目は素材から複製して文字だけ差し替える: `texts[].content`(JSON文字列)の `text` と `styles[].range=[0,文字数]`。フォント・縁取り・影・位置(`clip.transform`)・サイズ(`clip.scale`)は触らず見本のまま。

## BGM
- 曲ファイルはCapCutが `…/CapCut/User Data/Cache/music/<hash>.mp3` にキャッシュしたものを `audios[].path` で参照する。**そのMacにキャッシュがある曲しか再利用できない**(`os.path.exists` で確認。無ければユーザーにCapCutで曲を一度追加してもらう)。
- 見本の音量(`segment.volume`)は曲ごとに異なり、小さめ(0.05〜0.16)。そのまま踏襲する。

## iCloud 動画
- `ls -lO` の `dataless` = 実体なし。`brctl download <path>` → `ls -lO` から `dataless` が消えるまで待つ → 読む。戻すなら `brctl evict`(CapCutで編集するなら戻さない)。
- 4K・数百MB/本だと1本あたり数秒〜数十秒。26GB・100本で約18分かかった。バックグラウンド実行したら、ログファイルを定期的に読んで進捗を見る(通知は来ない)。

## 作業しやすい切り分け
- 全クリップ → ユーザーがCapCutでカット → 分割/装飾、の順に **ユーザーの編集を挟む**。分割や装飾は、ユーザーが保存した最新の `draft_info.json` を入力にする(更新時刻が自分の書き込みより新しければ、ユーザーの編集が入っている)。
- 既存を壊さない: 新しい名前で作る。やむを得ず既存へ追記するときは `.bak_*` を残す。
