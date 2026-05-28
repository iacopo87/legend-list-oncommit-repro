import type { LegendListRef } from '@legendapp/list/react-native';
import { KeyboardChatLegendList, useKeyboardChatComposerInset, useKeyboardScrollToEnd } from '@legendapp/list/keyboard-chat';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { Button, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardGestureArea, KeyboardProvider, KeyboardStickyView } from 'react-native-keyboard-controller';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

type PlacementStrategy = 'raf' | 'commit';

type Message = {
  id: string;
  isNew?: boolean;
  sender: 'user' | 'system';
  text: string;
  timeStamp: number;
};

type EventEntry = {
  id: number;
  text: string;
};

const INITIAL_AI_TEXT = `This is a long dynamic chat history.

Rows have natural text-driven heights. The send flow appends a new user message at the bottom, makes it the anchored row, and then needs one placement scroll above the composer.

The important bit: requestAnimationFrame is only a frame boundary. It does not mean Legend has measured the new dynamic row and committed anchored end space for that anchor.`;

const STRESS_MESSAGE_COUNT = 520;

const SEND_MESSAGE_VARIANTS = [
  'Short anchored message.',
  `Medium anchored message with enough wrapping text to need real native measurement before the anchored end-space math is final. This is intentionally longer than the estimate.`,
  `Very tall anchored message.

This row has several paragraphs and bullets so the measured height is far away from the list estimate.

- It is appended at the end.
- It becomes the anchored row.
- RAF can run before this natural height is measured.
- onCommit waits for Legend to commit anchored end space for the active anchor.

The point is not artificial timers. The point is ordinary dynamic text layout in a long virtualized chat.`,
];

const RESPONSE_SHAPES = [
  'Ok.',
  `A compact response that still wraps once or twice on a narrow phone screen.`,
  `This response is intentionally taller.

It uses multiple paragraphs so the real measured height is not close to nearby rows.

The repro is trying to make placement timing depend on actual committed measurement, not on a useful estimate.`,
  `Tall response.

${repeatedText('This paragraph makes one historical assistant response much taller than the next', 24)}

- Uneven row heights
- Virtualized measurement
- Anchored end space
- Keyboard composer space
- One-frame placement guesses`,
  `Very tall response.

${repeatedText('A long assistant answer with natural wrapping text and no stable row estimate', 48)}

The next row may be tiny again, which creates a deliberately uneven measurement profile.`,
];

let idCounter = 1;

function repeatedText(seed: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${seed} ${index + 1}.`).join(' ');
}

function makeStressMessage(index: number): Message {
  const sender = index % 3 === 0 ? 'user' : 'system';
  const shape = index % 13;
  const extra =
    shape === 0
      ? `\n\n${repeatedText('A very tall historical user message changes the measured-size distribution', 16)}`
      : shape === 1
        ? `\n${repeatedText('Medium historical user message', 8)}`
      : shape === 2
          ? ' tiny.'
      : shape === 3
            ? `\n\n- bullet one\n- bullet two\n- bullet three\n- bullet four\n- bullet five`
            : shape === 4
              ? ` ${repeatedText('wrapped text', 12)}`
              : '';

  return {
    id: `seed-${index}`,
    sender,
    text:
      sender === 'user'
        ? `Earlier user message ${index}.${extra}`
        : `${RESPONSE_SHAPES[index % RESPONSE_SHAPES.length]}\n\nReply ${index}.`,
    timeStamp: Date.now() - (STRESS_MESSAGE_COUNT - index) * 1000,
  };
}

const INITIAL_MESSAGES: Message[] = Array.from({ length: STRESS_MESSAGE_COUNT }, (_, index) => makeStressMessage(index));

function keyExtractor(message: Message) {
  return message.id;
}

function ChatMessage({ item }: { item: Message }) {
  if (item.sender === 'user') {
    return (
      <View style={styles.row}>
        <View style={[styles.messageContainer, styles.userMessageContainer, styles.userStyle]}>
          <Text style={[styles.messageText, styles.userMessageText]}>{item.text}</Text>
          <View style={[styles.timeStamp, styles.userStyle]}>
            <Text style={styles.timeStampText}>{new Date(item.timeStamp).toLocaleTimeString()}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={[styles.messageContainer, styles.systemMessageContainer, styles.systemStyle]}>
        <Text style={styles.messageText}>{item.text}</Text>
        <View style={[styles.timeStamp, styles.systemStyle]}>
          <Text style={styles.timeStampText}>{new Date(item.timeStamp).toLocaleTimeString()}</Text>
        </View>
      </View>
    </View>
  );
}

function ReproScreen() {
  const insets = useSafeAreaInsets();
  const listRef = useRef<LegendListRef>(null);
  const composerRef = useRef<View>(null);
  const nextEventIdRef = useRef(0);
  const pendingCommitAnchorRef = useRef<number | undefined>(undefined);
  const [anchorIndex, setAnchorIndex] = useState<number | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [inputText, setInputText] = useState(SEND_MESSAGE_VARIANTS[0]);
  const [placementStrategy, setPlacementStrategy] = useState<PlacementStrategy>('raf');
  const [events, setEvents] = useState<EventEntry[]>([]);

  const { contentInsetEndAdjustment, onComposerLayout } = useKeyboardChatComposerInset(listRef, composerRef, 92);
  const { scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });

  function appendEvent(event: string) {
    const nextEvent = {
      id: nextEventIdRef.current++,
      text: `${new Date().toLocaleTimeString()} ${event}`,
    };

    setEvents((previous) => [nextEvent, ...previous].slice(0, 8));
  }

  function runScrollMessageToEnd(source: string) {
    appendEvent(`${source}: scrollMessageToEnd`);
    void scrollMessageToEnd({ animated: true, closeKeyboard: true });
  }

  function sendMessage() {
    const text = inputText || 'Empty message';

    if (!text.trim()) {
      return;
    }

    const nextAnchorIndex = messages.length;
    const nextId = String(idCounter++);
    const nextDraft = SEND_MESSAGE_VARIANTS[idCounter % SEND_MESSAGE_VARIANTS.length];

    appendEvent(`send ${nextId} anchorIndex=${nextAnchorIndex}`);
    pendingCommitAnchorRef.current = nextAnchorIndex;
    setAnchorIndex(nextAnchorIndex);
    setMessages((messagesNew) => [
      ...messagesNew,
      { id: nextId, isNew: true, sender: 'user', text, timeStamp: Date.now() },
    ]);
    setInputText(nextDraft);

    if (placementStrategy === 'raf') {
      requestAnimationFrame(() => {
        runScrollMessageToEnd('raf');
      });
    }
  }

  function reset() {
    appendEvent('reset');
    pendingCommitAnchorRef.current = undefined;
    setAnchorIndex(undefined);
    setMessages(INITIAL_MESSAGES);
    setInputText(SEND_MESSAGE_VARIANTS[0]);
  }

  return (
    <KeyboardProvider>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <Text style={styles.title}>Legend onCommit chat repro</Text>
          <Text style={styles.explainer}>
            Send appends a dynamic user row after {STRESS_MESSAGE_COUNT} measured rows and sets anchorIndex to that
            row. RAF guesses when to place it; onCommit places it after Legend commits anchored end space.
          </Text>
          <View style={styles.buttonRow}>
            <Pressable
              style={styles.modeButton}
              onPress={() =>
                setPlacementStrategy((value) => (value === 'raf' ? 'commit' : 'raf'))
              }
            >
              <Text style={styles.modeButtonText}>
                {placementStrategy === 'commit' ? 'Using onCommit' : 'Using RAF'}
              </Text>
            </Pressable>
            <Button onPress={() => runScrollMessageToEnd('manual')} title="Manual scroll" />
            <Button onPress={reset} title="Reset" />
          </View>
          <Text style={styles.meta}>
            messages={messages.length} anchorIndex={anchorIndex} strategy={placementStrategy}
          </Text>
          <View style={styles.eventPanel}>
            {events.map((event) => (
              <Text key={event.id} style={styles.event}>
                {event.text}
              </Text>
            ))}
          </View>
        </View>

        <KeyboardGestureArea interpolator="ios" offset={60} style={styles.container}>
          <KeyboardChatLegendList
            ref={listRef}
            alignItemsAtEnd
            anchoredEndSpace={
              anchorIndex !== undefined
                ? {
                    anchorIndex,
                    onSizeChanged: (size) => {
                      appendEvent(`onSizeChanged(${size}) anchorIndex=${anchorIndex}`);
                    },
                    onCommit: (size) => {
                      appendEvent(`onCommit(${size}) anchorIndex=${anchorIndex}`);

                      if (
                        placementStrategy === 'commit' &&
                        size > 0 &&
                        pendingCommitAnchorRef.current === anchorIndex
                      ) {
                        pendingCommitAnchorRef.current = undefined;
                        runScrollMessageToEnd('onCommit');
                      }
                    },
                  }
                : undefined
            }
            contentContainerStyle={styles.contentContainer}
            contentInsetEndAdjustment={contentInsetEndAdjustment}
            data={messages}
            initialScrollAtEnd
            keyboardDismissMode="interactive"
            keyExtractor={keyExtractor}
            maintainScrollAtEnd
            maintainVisibleContentPosition
            recycleItems
            renderItem={ChatMessage}
            scrollIndicatorInsets={{ bottom: -insets.bottom }}
            style={styles.list}
          />
        </KeyboardGestureArea>

        <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }} style={styles.composerWrapper}>
          <View
            ref={composerRef}
            onLayout={onComposerLayout}
            style={[styles.inputContainer, { paddingBottom: insets.bottom + 10 }]}
          >
            <TextInput
              multiline
              onChangeText={setInputText}
              placeholder="Type a message"
              style={styles.input}
              value={inputText}
            />
            <Button onPress={sendMessage} title="Send" />
          </View>
        </KeyboardStickyView>
      </View>
    </KeyboardProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ReproScreen />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  buttonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  composerWrapper: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  container: {
    backgroundColor: '#fff',
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
  },
  event: {
    color: '#d1d5db',
    fontFamily: 'Courier',
    fontSize: 12,
  },
  eventPanel: {
    backgroundColor: '#111827',
    height: 96,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  explainer: {
    color: '#444',
    lineHeight: 20,
  },
  header: {
    backgroundColor: 'white',
    borderBottomColor: '#ddd',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
    padding: 16,
  },
  input: {
    backgroundColor: 'white',
    borderColor: '#ccc',
    borderRadius: 5,
    borderWidth: 1,
    color: 'black',
    flex: 1,
    marginRight: 10,
    minHeight: 42,
    padding: 10,
  },
  inputContainer: {
    alignItems: 'center',
    backgroundColor: '#fffffff2',
    borderColor: '#ccc',
    borderTopWidth: 1,
    flexDirection: 'row',
    padding: 10,
  },
  list: {
    flex: 1,
  },
  messageContainer: {
    borderRadius: 16,
    padding: 16,
  },
  messageText: {
    color: 'black',
    fontSize: 16,
    lineHeight: 22,
  },
  meta: {
    color: '#555',
    fontSize: 12,
  },
  modeButton: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 10,
  },
  modeButtonText: {
    color: 'white',
    fontWeight: '700',
  },
  row: {
    justifyContent: 'center',
    paddingVertical: 6,
  },
  systemMessageContainer: {},
  systemStyle: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
  },
  timeStamp: {},
  timeStampText: {
    color: '#888',
    fontSize: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  userMessageContainer: {
    backgroundColor: '#007AFF',
  },
  userMessageText: {
    color: 'white',
  },
  userStyle: {
    alignItems: 'flex-end',
    alignSelf: 'flex-end',
    maxWidth: '75%',
  },
});
