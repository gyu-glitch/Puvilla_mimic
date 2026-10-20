# Codex independent workspace

This directory is the Codex-owned copy. Claude continues in `C:/SSG_Christmas/pubilla-mimic`.

- Edit only this project and `C:/SSG_Christmas/pubilla-mimic-codex-hosting` for this work.
- Treat `../pubilla-mimic` and `../pubilla-mimic-hosting` as read-only references. Never deploy to their current.txt or preview.txt.
- Planned Codex URL: https://nau-gyuchan.tailc22fe0.ts.net:10000/ → 127.0.0.1:4175. External activation is NOT complete: the setup command was blocked by automatic approval review on 2026-10-20. Do not report this URL as live without verification.
- Codex development server: http://localhost:5175/.
- `npm run deploy` in THIS directory builds only into `../pubilla-mimic-codex-hosting` and updates its current.txt. Keep all builds for comparison; no automatic deletion.
- Original production reference is `../pubilla-mimic-codex-hosting/baseline-20261020-004619`. Do not modify it.
- Original standing model and fitted scarf in `work/stand` were copied from that production build. Keep these source files unchanged; write experiments to new files.
- The cut-arm approach (`stand_arm_split.py`, `pu_stand_arm.obj/json`) was rejected by the user. Its presence in this snapshot is historical context, not an approved solution.
- `stand_wave_arap.py` is an unvalidated candidate copied from Claude's work. Evaluate deformation and reference pose before choosing it.
- Do not use `work/sit1015` for the current standing-character task.
- Earlier README/CLAUDE/HANDOFF deployment addresses refer to the original project. This file governs Codex workspace ownership and deployment.
- Preserve the face, scarf, fur, background, and filter baseline while developing the requested arm behavior. Do not change the vendor oil filter.

