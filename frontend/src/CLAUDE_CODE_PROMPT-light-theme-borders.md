# Fix: Light-theme borders barely visible

## Problem
In the light theme, every border across the app is nearly invisible. All borders derive
from 5 CSS custom properties defined in the `:root` block of
`frontend/src/index.css`. In light theme these sit at 88–90% lightness — only ~10%
darker than the pure-white cards (`--card: 0 0% 100%`) and near-white background
(`--background: 220 20% 97%`), so cards, table rows, inputs, the sidebar divider, and
popovers all lose their edges.

No component changes are needed — every border uses these tokens
(`border-border`, `border-card-border`, `border-input`, `border-sidebar-border`,
`border-popover-border`), so fixing the tokens fixes all pages at once.
The `.dark` theme is unaffected.

## Change
In `frontend/src/index.css`, inside the **`:root`** block only, replace these five values:

```diff
 :root {
   --background: 220 20% 97%;
   --foreground: 224 30% 10%;
-  --border: 220 15% 88%;
+  --border: 220 14% 82%;
   --card: 0 0% 100%;
   --card-foreground: 224 30% 10%;
-  --card-border: 220 15% 90%;
+  --card-border: 220 14% 84%;
   --sidebar: 220 20% 98%;
   --sidebar-foreground: 224 30% 20%;
-  --sidebar-border: 220 15% 88%;
+  --sidebar-border: 220 14% 82%;
   ...
   --popover: 0 0% 100%;
   --popover-foreground: 224 30% 10%;
-  --popover-border: 220 15% 88%;
+  --popover-border: 220 14% 82%;
   ...
-  --input: 220 15% 85%;
+  --input: 220 15% 76%;
   --ring: 180 80% 38%;
 }
```

## Rationale
- **Card / general / sidebar / popover borders → 82–84% L:** clearly perceptible against
  white and near-white surfaces without looking heavy or boxed-in.
- **`--input` → 76% L:** form fields need the strongest edge so users can see the tappable
  boundary of every input and select. This is the most important one for usability.
- Hue nudged 15→14% saturation to keep the grey neutral (optional, cosmetic).
- Do **not** touch the `.dark` block — dark-theme borders are already fine.

## Verify
Toggle to light theme and confirm: stat cards, the Recent-leads table rows, Quick-add
inputs/selects, the sidebar divider, and any open dropdown/dialog all have visible edges.
