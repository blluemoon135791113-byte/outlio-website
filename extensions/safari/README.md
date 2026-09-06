# Safari target

**Nothing is generated here yet, and that is deliberate.**

Safari extensions are macOS/iOS apps. They require Xcode and a paid Apple
Developer Program membership ($99/yr) to sign, and Safari refuses unsigned
extensions outside a short-lived developer session. Without that account there
is no build to produce — so committing a half-generated Xcode project would
look finished while being unusable.

## When an account is available

```bash
npm run ext:chrome

xcrun safari-web-extension-converter extensions/dist/chrome \
  --project-location extensions/safari \
  --app-name "Outlio Lead Capture" \
  --bundle-identifier io.outlio.leadcapture
```

The converter consumes the Chrome build unchanged. That is the payoff of
keeping every entry point in `extensions/shared/` — Safari needs no separate
implementation, only a wrapper and a signature.

Then: open the generated project in Xcode, set the signing team, run once
locally to verify, and submit to the App Store.

See `docs/EXTENSION.md` §5.
