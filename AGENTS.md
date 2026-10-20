# Codex independent workspace

This directory is the Codex-owned copy. Claude continues in `C:/SSG_Christmas/pubilla-mimic`.

- Edit only this project and `C:/SSG_Christmas/pubilla-mimic-codex-hosting` for this work.
- Treat `../pubilla-mimic` and `../pubilla-mimic-hosting` as read-only references. Never deploy to their current.txt or preview.txt.
- Exception explicitly authorized by the user on 2026-10-20: promote the reviewed v29 `codex-20261020-094057` build to the original public hosting. Copy that immutable build into a separate release directory and change only its public current.txt, preserving the old build and rollback pointer. This is a one-time promotion; subsequent development and deployments stay in the Codex project/hosting and must not automatically update public production. Claude's source tree and preview.txt remain untouched.
- Later on 2026-10-20 the user prioritized the twisted left hand and explicitly requested immediate public promotion once improved. This authorizes the verified v31 palm-rotation recovery fix to be copied and promoted with the same separate-release/rollback process. It does not authorize publishing the deferred v30 shoulder experiment or unrelated unverified work.
- Later the user explicitly requested publishing the reviewed v36 camera-aspect/output-mirror version ("배포용에반영해야해"). Promoted immutable codex-20261020-122553 as codex-promoted-20261020-122553, preserving v31 and current.before-codex-v36.txt. Subsequent development stays separate; this is not blanket authorization for future public promotions.
- The user's immediate public v36 report ("움직여도 반응이 없는데") was handled as a correction to that authorized release: v37 codex-20261020-123721 fixes portrait presence normalization and is promoted with current.before-codex-v37.txt preserving v36. This does not authorize unrelated future public promotions.
- Follow-up "락도너무자주풀려" is the same public-input correction: v38 codex-20261020-124504 corrects aspect-aware face association and lock continuity, preserving v37 with current.before-codex-v38.txt. Unrelated future experiments still remain on development hosting.
- The ongoing public camera-input request now includes 90-degree cycling rotation. v39 codex-20261020-125513 adds the requested input rotation and is promoted with current.before-codex-v39.txt preserving v38. Future unrelated experiments remain on development hosting.
- The immediate v39 onsite report ("락온이 아예 안됨 이 인풋에서") takes priority over the requested F shortcut. v40 codex-20261020-131219 adds verified face-recovery inference and the completed F icon toggle, promoted with current.before-codex-v40.txt preserving v39. The supplied photograph stays local and is not included in hosting.
- Codex URL: https://nau-gyuchan.tailc22fe0.ts.net:10000/ → 127.0.0.1:4175. Activated and verified on 2026-10-20 using a separate Funnel command after the local static server was running. Existing 443 and 8443 routes remain unchanged.
- Codex development server: http://localhost:5175/.
- `npm run deploy` in THIS directory builds only into `../pubilla-mimic-codex-hosting` and updates its current.txt. Keep all builds for comparison; no automatic deletion.
- Original production reference is `../pubilla-mimic-codex-hosting/baseline-20261020-004619`. Do not modify it.
- Original standing model and fitted scarf in `work/stand` were copied from that production build. Keep these source files unchanged; write experiments to new files.
- The cut-arm approach (`stand_arm_split.py`, `pu_stand_arm.obj/json`) was rejected by the user. Its presence in this snapshot is historical context, not an approved solution.
- `stand_wave_arap.py` is an unvalidated candidate copied from Claude's work. Evaluate deformation and reference pose before choosing it.
- Do not use `work/sit1015` for the current standing-character task.
- Earlier README/CLAUDE/HANDOFF deployment addresses refer to the original project. This file governs Codex workspace ownership and deployment.
- Preserve the face, scarf, fur, background, and filter baseline while developing the requested arm behavior. Do not change the vendor oil filter.
- Official 3D guide: `../asset/PUUVILLA IP FINAL/1 GUIDE/Puuvilla Character Guidebook_0911_FINAL.pdf`, especially pages 24, 31–33 and 44–50. Read `docs/PUUVILLA_3D_GUIDE.md` for verified findings. Preserve source hand/arm proportions; do not reintroduce paw expansion, axial shortening or global shoulder scaling to hide rig problems.

