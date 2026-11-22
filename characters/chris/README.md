# Chris

The presenter of VoxAvatar Studio videos. A stylized 3D cartoon character.
Machine-readable settings are in `character.json`.

## Identity lock
Chris's identity is set by **one source image only**: `Personnage/Homme 3D à lunettes et bouc-6.png`.
The other images in `Personnage/` do not always have the same face, so they must not be used for generation.

- Short tousled brown hair, greying at the temples
- Black rectangular glasses
- Long light-brown goatee, no moustache
- Charcoal grey V-neck T-shirt, blue jeans, black smartwatch on the left wrist
- Friendly half-smile, three-quarter view facing the viewer's right

## Reference images
| Format | File | Framing |
|---|---|---|
| 9:16 | `ref/chris-9x16.png` (1080×1920) | down to mid-thigh |
| 4:5 | `ref/chris-4x5.png` (1080×1350) | down to the hips |
| 1:1 | `ref/chris-1x1.png` (1080×1080) | down to the waist |

All are on pure green `#00FF00`. Chris's pixels are cut out locally with rembg and are never redrawn by AI.
To rebuild them: `python scripts/prepare_chris_reference.py` (needs `python -m pip install "rembg[cpu]"`).

## Voice
ElevenLabs library voice. Its ID is read from `ELEVENLABS_VOICE_ID` (in `.env.local`, not versioned). Model `eleven_multilingual_v2`, French.

## Known behaviour (tests of 2026-11-22)
- Kling AI Avatar v2 Pro keeps the identity and the cartoon style. The mouth moves well, with small natural head and hand gestures.
- The output ratio follows the input image: 1080×1920 in gives 1072×1920 out, at 30 fps.
- Kling adds about 1.6 s of silent, billed tail where Chris smiles with his mouth closed. Trim it at assembly.
- Kling's green drifts slightly, from (3,245,1) to (26,215,39), and still keys cleanly with `chromakey=0x00FF00:0.28:0.08,despill=type=green`.
- Generation takes about 40 s per second of video.
