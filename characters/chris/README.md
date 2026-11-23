# Chris

The presenter of VoxAvatar Studio videos. A stylized 3D cartoon character.
Machine-readable settings are in `character.json`. Outfits and poses are listed in `tenues.json`.

## Identity lock
Chris's identity is set by the images in `Personnage/Tenues/<outfit>/`: `debout.png` (standing) and `assis.png`
(seated behind a desk). Every outfit keeps the same face, glasses and goatee. The default look is
`Personnage/Tenues/T-shirt gris/debout.png`.

- Short tousled brown hair, greying at the temples
- Black rectangular glasses
- Long light-brown goatee, no moustache
- Default outfit: charcoal grey V-neck T-shirt, blue jeans, black smartwatch on the left wrist
- Friendly half-smile, three-quarter view facing the viewer's right

## Reference images
One image per outfit, pose and format: `tenues/<outfit id>/<standing|seated>/chris-<9x16|4x5|1x1>.png`.

| Pose | 9:16 (1080×1920) | 4:5 (1080×1350) | 1:1 (1080×1080) |
|---|---|---|---|
| standing | down to mid-thigh | down to the hips | down to the waist |
| seated | desk across the bottom, empty space above the head for image cards | same | same |

All are on pure green `#00FF00`. Chris's pixels are cut out locally with rembg and are never redrawn by AI.
To add an outfit: drop `debout.png` and/or `assis.png` in a new `Personnage/Tenues/<name>/` folder, then run
`python scripts/prepare_outfits.py` (needs `python -m pip install "rembg[cpu]"`) and `npm run upload:character`.
A project uses one outfit and one pose; a Chris video made with another one must be generated again.

## Voice
ElevenLabs library voice. Its ID is read from `ELEVENLABS_VOICE_ID` (in `.env.local`, not versioned). Model `eleven_multilingual_v2`, French.

## Known behaviour (tests of 2026-11-22)
- Kling AI Avatar v2 Pro keeps the identity and the cartoon style. The mouth moves well, with small natural head and hand gestures.
- The output ratio follows the input image: 1080×1920 in gives 1072×1920 out, at 30 fps.
- Kling adds about 1.6 s of silent, billed tail where Chris smiles with his mouth closed. Trim it at assembly.
- Kling's green drifts slightly, from (3,245,1) to (26,215,39), and still keys cleanly with `chromakey=0x00FF00:0.28:0.08,despill=type=green`.
- Generation takes about 40 s per second of video.
