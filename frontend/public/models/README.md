Face-api.js model weights for facial recognition, vendored into the repo so
the app can compute a face descriptor offline (no dependency on the CDN
fallback below).

These are committed binary files, not placeholders. Do not delete them.

## Files (6, all versioned in git)

- `tiny_face_detector_model-weights_manifest.json`
- `tiny_face_detector_model.bin`
- `face_landmark_68_model-weights_manifest.json`
- `face_landmark_68_model.bin`
- `face_recognition_model-weights_manifest.json`
- `face_recognition_model.bin`

Each `*-weights_manifest.json` lists its weight file by name under `paths`;
the loader (`tf.io`, via face-api.js) fetches whatever the manifest says, so
the manifest and its `.bin` file must always be replaced together and must
reference each other correctly.

Note: this is the current `@vladmandic/face-api` model format, one `.bin`
file per net (face_recognition_model.bin is ~6.1 MB, unsharded). It is not
the older shard1/shard2-per-net convention some face-api.js forks use -
verify the manifest's `paths` before assuming a downloaded file's name.

## Where they came from

Downloaded from the same origin `loadFaceModels`
(`frontend/src/pages/ColaboradorDashboard.tsx`) already falls back to:

```
https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/<file>
```

i.e. the `model/` folder of the `@vladmandic/face-api` npm package (npm
`face-api.js` dependency version: see `frontend/package.json`, `^0.22.2`;
the CDN fallback intentionally points at the actively maintained fork, which
publishes a compatible model format).

## How to re-fetch them

```sh
BASE=https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model
for f in \
  tiny_face_detector_model-weights_manifest.json \
  tiny_face_detector_model.bin \
  face_landmark_68_model-weights_manifest.json \
  face_landmark_68_model.bin \
  face_recognition_model-weights_manifest.json \
  face_recognition_model.bin; do
  curl -fSL -o "$f" "$BASE/$f"
done
```

Or from the npm package directly: `npm pack @vladmandic/face-api` and copy
the same 6 files out of its `model/` folder.

After re-fetching, sanity-check before committing:
- Each `.bin` file should be tens of KB to a few MB (a saved 404 page is a
  few KB and won't look out of place next to a small manifest - check size,
  not just presence).
- Each `*-weights_manifest.json` must be valid JSON, and its `paths` entries
  must exactly match the `.bin` filename sitting next to it.

## Service worker precache

`frontend/vite.config.ts` explicitly extends the Workbox `globPatterns` with
`models/*.{json,bin}` and raises `maximumFileSizeToCacheInBytes` to fit
`face_recognition_model.bin`. Workbox's defaults (`**/*.{js,wasm,css,html}`,
2 MiB cap) would otherwise silently drop these files from the precache -
if you add or resize model files, re-check that setting still covers them.
