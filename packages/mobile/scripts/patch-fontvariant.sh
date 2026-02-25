#!/bin/bash
# Patch node_modules for React Native Web compatibility.
# 1) fontVariant: ['tabular-nums'] → fontVariantNumeric: 'tabular-nums'
# 2) react-dom: flatten numeric-keyed style objects from react-native-web's styleq
# 3) react-dom: guard setValueForStyle against numeric keys

cd "$(dirname "$0")/.." || exit 1

# --- Patch 1: fontVariant arrays ---
FILES=$(grep -rl "fontVariant: \['tabular-nums'\]" node_modules/ 2>/dev/null)
if [ -n "$FILES" ]; then
  for f in $FILES; do
    sed -i '' "s/fontVariant: \['tabular-nums'\]/fontVariantNumeric: 'tabular-nums'/g" "$f" 2>/dev/null || \
    sed -i "s/fontVariant: \['tabular-nums'\]/fontVariantNumeric: 'tabular-nums'/g" "$f"
    echo "Patched fontVariant: $f"
  done
else
  echo "No fontVariant patches needed"
fi

# --- Patch 2 & 3: react-dom style flattening + numeric key guard ---
# react-native-web's styleq returns style objects with numeric keys {0: {...}, 1: {...}}
# instead of flat CSS objects. React DOM's setValueForStyles crashes when iterating these.
# This patch adds a __flattenRNStyle helper that flattens both styles AND prevStyles,
# and guards setValueForStyle against numeric key names.

node -e '
const fs = require("fs");
const files = [
  "node_modules/react-dom/cjs/react-dom-client.development.js",
  "node_modules/react-dom/cjs/react-dom-client.production.js",
  "node_modules/react-dom/cjs/react-dom-profiling.development.js",
  "node_modules/react-dom/cjs/react-dom-profiling.profiling.js",
];

const FLATTEN_HELPER = `function __flattenRNStyle(s) {
    if (s == null || typeof s !== "object") return s;
    if (Array.isArray(s)) {
      var f = {};
      for (var i = 0; i < s.length; i++) {
        var t = s[i];
        if (t != null && typeof t === "object") Object.assign(f, Array.isArray(t) ? __flattenRNStyle(t) : t);
      }
      return f;
    }
    var ks = Object.keys(s);
    if (ks.length > 0 && !isNaN(Number(ks[0]))) {
      var f2 = {};
      for (var j = 0; j < ks.length; j++) {
        var kk = ks[j], vv = s[kk];
        if (!isNaN(Number(kk))) { if (vv != null && typeof vv === "object") Object.assign(f2, vv); }
        else f2[kk] = vv;
      }
      return f2;
    }
    return s;
  }
  styles = __flattenRNStyle(styles);
  prevStyles = __flattenRNStyle(prevStyles);`;

for (const file of files) {
  if (!fs.existsSync(file)) { console.log("Skip (not found):", file); continue; }
  let code = fs.readFileSync(file, "utf8");
  let changed = false;

  // Patch setValueForStyle: add numeric key guard
  const svfsPat = /function setValueForStyle\(style, styleName, value\) \{/g;
  if (!code.includes("isNaN(Number(styleName))")) {
    code = code.replace(svfsPat, (match) => {
      changed = true;
      return match + "\n  if (!isNaN(Number(styleName)) && styleName !== \"\") return;";
    });
  }

  // Patch setValueForStyles: replace old patch or add new one
  if (code.includes("__flattenRNStyle")) {
    console.log("Already has __flattenRNStyle:", file);
  } else {
    // Remove old Array.isArray-only patch if present
    const oldPatchRegex = /function setValueForStyles\(node, styles, prevStyles\) \{[\s\S]*?if\s*\(Array\.isArray\(styles\)\)\s*\{[\s\S]*?styles\s*=\s*_flat;\s*\}/;
    if (oldPatchRegex.test(code)) {
      code = code.replace(oldPatchRegex, (match) => {
        changed = true;
        return "function setValueForStyles(node, styles, prevStyles) {\n  " + FLATTEN_HELPER;
      });
    } else {
      // No old patch, insert after function opening
      code = code.replace(
        /function setValueForStyles\(node, styles, prevStyles\) \{/g,
        (match) => {
          changed = true;
          return match + "\n  " + FLATTEN_HELPER;
        }
      );
    }
  }

  if (changed) {
    fs.writeFileSync(file, code, "utf8");
    console.log("Patched:", file);
  } else {
    console.log("Already patched:", file);
  }
}
'

echo "All patches applied."
