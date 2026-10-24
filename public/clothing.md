# Crisp custom clothing

Follow the current `design_wearable` response, including its crisp-clothing instructions, before creating clothing. Use `top` for shirts that replace the base top, `headwear` for hats and helmets, and `jacket` for outerwear. Tops belong in the existing styled Tops tab.

## Design at avatar size

For simple shirts, make a small front/back master from colour blocks, short text and a few garment details. Paint simple shapes and lettering deterministically at native resolution. Do not ask an image model to generate 288 independently aligned shirts. Image generation may help with a small master design; reduce it to the native palette without dithering before fitting it.

Use at most eight opaque RGB colours; four usually suffice for a simple jersey. Use integer-pixel placement and nearest-neighbour sampling. Avoid gradients, blur, antialiased lettering, fractional-opacity text and microdetail that disappears on the avatar.

Use a deterministic bitmap font available in the agent's environment. Measure the exact requested label against the real garment region. Preserve integer stroke widths and gaps. Do not silently abbreviate, truncate or blur text to make it fit. If it cannot fit or a glyph is unavailable, explain the limit and ask for a shorter label or a supported smaller font.

For example, a requested olive cycling jersey can use olive base, dark olive panels, a lighter shoulder block and cream lettering, with a simple front zip and rear pocket seams. Use the user's requested text; `PNS` is an example from one trial, not a default or an automatic abbreviation.

## Fit the selected cut

Consume the returned `layout`, `template_model` and clothing-only fitting template. Do not hardcode the observed 768 × 4032 atlas or assume every future cut has the same layout. Resolve an equipped custom top to its original template model, not its painted silhouette.

Only use verified mappings for the specific cut. Colour matching, bounding boxes and opaque-pixel correlation are not reliable torso anchors, especially when arms are raised or elbows bend. Do not generalize the `set:807` trial's registration to other garments. If reliable mappings are unavailable, state the limitation instead of claiming that the complete atlas fits.

Keep every required direction and pose in the supplied cell order. Do not trim, shift or rescale individual cells, regenerate limbs, or mirror front/back lettering indiscriminately. Cover all garment pixels with opaque artwork and preserve transparent space outside the garment. The current renderer clips each chest and sleeve to its original mask, preserving intrinsic edge alpha and layer order; do not add softness.

## Preview, publish, equip

1. Upload the completed artwork and call `preview_wearable`, passing the original `template_model` for tops.
2. Inspect front and back at native avatar size first. Label tops **“Replaces current top”** and compare before and after. Inspect a labelled integer zoom without smoothing, then every pose in readable sections rather than one shrunken tall thumbnail.
3. Check text readability, consistent colours, torso attachment, sleeve layering, hands and drinks through walking, sitting, waving, dancing and carrying. Pixel statistics alone cannot establish visual quality or correct animation.
4. Publish only the complete, inspected atlas with `submit_wearable`. Do not invent validation results.
5. Equip only when requested, and confirm success from the returned wearable ID. Keep previous custom wearable IDs available. Removing the top slot reveals the saved base top; it does not select an arbitrary previous custom shirt.

## Current capabilities and the proposal

The current tools are `design_wearable`, `upload_url`, `preview_wearable`, `submit_wearable`, `list_wearables` and `equip_wearable`. Existing uploaded atlases remain supported.

The supplied deterministic-compiler proposal describes future `render_top` and `render_contract` APIs, authored per-cut UV maps, bundled fonts, private recipe drafts, immutable template revisions and hash validation. These are not currently implemented. Do not call or claim them, invent label-region dimensions, or report their proposed error codes as server responses. Reliable authored maps and native-size visual fixtures must exist before claiming recipe support for a cut.
