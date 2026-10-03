
## iPad

The web app is wrapped with Capacitor (`ios/`, iPad only, iOS 16+).

```
npm run build && npx cap sync ios
open ios/App/App.xcodeproj
```

In Xcode pick the *App* target, Signing & Capabilities, sign in with an Apple ID (a free personal team is enough to run on your own iPad), choose the device and press Run. TestFlight / App Store need a paid Apple Developer account.

Untested on a real iPad: sound, video export (WebCodecs), share sheet, performance. The UI and the self-tests were checked in the iPad simulator and in WebKit at 820x1180 and 1180x820.
