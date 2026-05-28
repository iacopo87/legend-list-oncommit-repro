# Legend `anchoredEndSpace.onCommit` Repro

This Expo app is a minimal reproduction for avoiding app-side `requestAnimationFrame` scroll placement after changing `anchoredEndSpace`.

It reuses the shape of the Legend keyboard chat example: `KeyboardProvider`, `KeyboardGestureArea`, `KeyboardStickyView`, `KeyboardChatLegendList`, a bottom text composer, long highly-variable dynamic chat history, user/system message bubbles, `initialScrollAtEnd`, `maintainVisibleContentPosition`, `recycleItems`, and a send action.

Each tap appends a user message at the bottom of a long dynamic-height chat and makes that new row the anchor. The history intentionally mixes tiny, medium, tall, and very tall assistant responses, and the list does not pass `estimatedItemSize`, so Legend has to rely on real RN layout measurement before anchored end space is final.

## Example

![Android demo](androidDemo.gif)

Existing chat examples commonly do this after adding a row and changing the anchor:

```ts
// Wait for React to commit the new row before measuring and scrolling to the end.
requestAnimationFrame(() => {
  scrollMessageToEnd({ animated: true, closeKeyboard: true });
});
```

That waits for a frame because there is no callback that says "Legend processed this anchor config." In a long dynamic list, a single RAF can still fire before Legend has measured the newly appended anchored row and committed a positive anchored end-space size.

The app-side mistake this demonstrates is scrolling from render timing. If the app needs the final anchored placement, it should wait for Legend to commit the corresponding anchored end-space decision. `onCommit(size)` gives that list-side causal signal.

`onSizeChanged(size)` is not the right synchronization point: it is a size bridge, and it may not fire when a later anchored message needs the same computed blank space.

The proposed patch adds `onCommit(size)`, which fires after Legend processes the anchor config when either the committed size changes or the `anchorIndex` changes.

## Included Patch

This repro contains the patch it needs:

- `patches/@legendapp__list@3.0.0-beta.56.patch` is applied by pnpm through `patchedDependencies`.
- The patch adds the `anchoredEndSpace.onCommit(size)` callback to the installed `@legendapp/list` package.

## Run

```bash
pnpm install
pnpm ios
pnpm android
```

This repro uses `react-native-keyboard-controller`, so run it in an Expo development build. The app includes `expo-dev-client` and a fixed `scheme` for dev-client deep links.

`pnpm ios` and `pnpm android` build and install the native development app with `expo run:*`. After a dev build is installed, you can start Metro separately with:

```bash
pnpm start
```

If you change native dependencies, rebuild the development app and restart Metro with a clean cache:

```bash
pnpm exec expo run:ios --clear
pnpm exec expo run:android --clear
```

## Reproduction Steps

1. Switch to `Using RAF`.
2. Tap `Send`.
3. Observe the current workaround: wait one frame, then `scrollMessageToEnd`.
4. Switch to `Using onCommit`. The included pnpm patch makes this callback available in the installed package.
5. Tap `Send` multiple times.
6. Observe that placement happens after `onCommit(size > 0)`, when Legend has committed usable anchored end space for the appended row.

## Expected With The Patch

`onSizeChanged(size)` remains size-only. `onCommit(size)` is the callback for "Legend processed and committed this anchor configuration", including same-size `anchorIndex` changes. Apps can use it instead of a frame-delay scroll after updating chat data.
