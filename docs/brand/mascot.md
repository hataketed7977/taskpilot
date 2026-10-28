# TaskPilot Mascot

- **Status:** Proposed
- **Owns:** The TaskPilot mascot character definition, identity invariants,
  approved artwork inventory, and rules for deriving new mascot artwork
- **Read after:** [`../README.md`](../README.md)
- **Mandatory before:** Creating, editing, regenerating, or placing mascot
  artwork in any document, Desktop screen, website, or merchandise

## Status and Scope

The character design is selected, but it is not yet approved for product use:
a similarity revision and a name are still open (see
[Open Decisions](#open-decisions)). The image files listed below exist in this
directory and are the only approved source artwork.

This document owns the mascot only. It does not change the Desktop visual
system, which remains owned by
[`../../apps/desktop/docs/design-foundation.md`](../../apps/desktop/docs/design-foundation.md).
No Desktop screen currently uses the mascot.

## Character Concept

The mascot is a **chubby otter pilot**. Otters are tool-using animals, which
maps to TaskPilot's Agents that use tools inside controlled workflows; the
aviator outfit maps to the product name. The character is calm, capable, and
friendly rather than comic.

## Identity Invariants

Every mascot image must keep all of the following. Only pose, expression,
camera angle, props, scene, and lighting may change.

| Element | Rule |
| --- | --- |
| Species and proportion | One otter, about two heads tall, round body |
| Limbs | Exactly two arms, two legs, and one tail in every view and pose |
| Body color | Warm light-brown fur, cream belly and muzzle, dark-brown paws and tail |
| Helmet | Deep-teal soft leather aviator helmet with round ear flaps |
| Goggles | Round goggles with amber frames, normally pushed up on the helmet brim |
| Scarf | Short deep-teal scarf knotted at the character's left side (viewer's right) |
| Eyes | Solid near-black round eyes, each with one small white highlight at upper left |
| Face | Dark-brown nose, short whiskers, small closed smile by default |
| Material (3D) | Matte soft-vinyl collectible-toy finish, no realistic fur |
| Material (flat) | Uniform rounded near-black-green outline, flat fills, at most one shadow tone |

### Eye Rule

Real otters have brown eyes ranging from light amber to near black, so the
mascot uses solid dark eyes. Never show a white sclera or a colored iris. Express
emotion with eyebrows, eye shape (open, squinting, closed), highlight position,
and mouth shape instead.

## Color Intent

These are the target colors specified when the artwork was generated. They are
**not** measured from the JPEG files, which contain lighting and compression
variation; do not sample pixels to derive brand tokens.

| Role | Target | Relationship |
| --- | --- | --- |
| Helmet, scarf, check marks | `#006B5D` | Same value as Desktop `teal-700` |
| Eyes and flat-style outline | `#18211F` | Same value as Desktop `ink-950` |
| Plain background | `#F1F4F2` | Same value as Desktop `mineral-50` |
| Goggle frames | Amber | Mascot-only accent; not a Desktop token |

## Approved Artwork

All files are JPEG on an opaque light background. None is a transparent PNG or
vector source.

| File | Content | Pixels | Intended use |
| --- | --- | --- | --- |
| [`mascot/otter-pilot-master-3d.jpg`](mascot/otter-pilot-master-3d.jpg) | Master image: standing, wrench and checked task card | 1831 × 2289 | Identity reference for every derivative |
| [`mascot/otter-pilot-flat.jpg`](mascot/otter-pilot-flat.jpg) | Flat vector-style version of the master | 2048 × 2048 | Avatar, README, sticker, icon exploration |
| [`mascot/otter-pilot-turnaround.jpg`](mascot/otter-pilot-turnaround.jpg) | Front, side, and back views, empty hands | 2730 × 1535 | Modeling and illustration reference |
| [`mascot/otter-pilot-expressions.jpg`](mascot/otter-pilot-expressions.jpg) | Happy, thinking, awaiting approval, done, error | 2730 × 1535 | Empty, loading, approval, success, and error states |
| [`mascot/otter-pilot-actions.jpg`](mascot/otter-pilot-actions.jpg) | Flying run, laptop work, posting a card to a board, floating rest | 2730 × 1535 | Marketing and onboarding illustration |

### Known Defects

| File | Defect |
| --- | --- |
| `otter-pilot-turnaround.jpg` | Back view shows the scarf tail at the center of the neck; front and side views knot it at the side |
| `otter-pilot-expressions.jpg` | Error state keeps the goggles on the brim instead of pulled down crooked |
| `otter-pilot-actions.jpg` | The card in the floating-rest pose shows a short bar instead of a check mark |

## Deriving New Artwork

1. Start from `otter-pilot-master-3d.jpg` as the image reference. Do not
   recreate the character from a text prompt alone.
2. Restate every [identity invariant](#identity-invariants) in the request,
   including the limb count and the eye rule.
3. Generate one deliverable per image; a turnaround or expression sheet counts
   as one deliverable.
4. Review the result at full size for limb count, eye style, scarf knot side,
   and unrequested text before adopting it.
5. Add the adopted file to this directory with an `otter-pilot-<content>`
   kebab-case name, update the artwork table, and remove the superseded file in
   the same change.

Images rendered by the Desktop must not be loaded from this directory. When a
screen adopts the mascot, export the needed size and format into the Desktop
source tree under that subproject's rules and keep this directory as the source
reference.

## Open Decisions

| Decision | Why it is open | Must be resolved before |
| --- | --- | --- |
| Similarity revision | Jett the SEA Otter, the Seattle-Tacoma International Airport mascot introduced in December 2024, is also an otter with aviator goggles and a green scarf. The proposed change is to make the scarf amber or remove it so the teal helmet becomes the sole signature. | Any public or product use |
| Name | Not chosen. Avoid names already used by otter mascots, including Jett and Turbo. | Public use |
| Clearance and authorship | The artwork is AI-generated. A designer redraw, a trademark search, and legal review are recommended before it becomes a registered brand asset. | Trademark filing or merchandise |
| Transparent and vector exports | Only opaque JPEG files exist. | Overlaying the mascot on UI or producing icons |
| Amber accent | Introduced for the mascot; the Desktop palette has no amber token. | Adding mascot color to Desktop tokens |
