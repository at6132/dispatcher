import { createElement, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';

import { Button } from './Button';
import { colors, fonts, radius, space, type } from '../../theme';

type DateTimeFieldProps = {
  label: string;
  value: Date;
  onChange: (next: Date) => void;
  error?: string;
  editable?: boolean;
  /** Earliest selectable time (defaults to now). */
  minimumDate?: Date;
};

function formatScheduled(d: Date): string {
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (sameDay) {
    const soon = d.getTime() - now.getTime() < 90_000;
    return soon ? `Now · ${time}` : `Today · ${time}`;
  }
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${date} · ${time}`;
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDatetimeLocalValue(raw: string): Date | null {
  if (!raw) return null;
  const next = new Date(raw);
  return Number.isNaN(next.getTime()) ? null : next;
}

export function DateTimeField({
  label,
  value,
  onChange,
  error,
  editable = true,
  minimumDate,
}: DateTimeFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const min = minimumDate ?? new Date();
  const webMin = useMemo(() => toDatetimeLocalValue(min), [min]);

  const openPicker = () => {
    if (!editable) return;
    setDraft(value.getTime() < min.getTime() ? min : value);
    setOpen(true);
  };

  const commit = (next: Date) => {
    const clamped = next.getTime() < min.getTime() ? min : next;
    onChange(clamped);
  };

  const onAndroidChange = (event: DateTimePickerEvent, date?: Date) => {
    setOpen(false);
    if (event.type === 'dismissed' || !date) return;
    commit(date);
  };

  const onIosChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (date) setDraft(date);
  };

  const onWebChange = (raw: string) => {
    const next = parseDatetimeLocalValue(raw);
    if (!next) return;
    commit(next);
  };

  return (
    <View style={styles.wrap}>
      {Platform.OS === 'web' ? (
        <View
          style={[
            styles.field,
            !!error && styles.fieldError,
            !editable && styles.disabled,
          ]}
        >
          <View style={styles.inner}>
            <Text style={styles.label}>{label}</Text>
            {/* RN-web: DateTimePicker has no web UI — use native datetime-local. */}
            {createElement('input', {
              type: 'datetime-local',
              'aria-label': label,
              disabled: !editable,
              min: webMin,
              value: toDatetimeLocalValue(
                value.getTime() < min.getTime() ? min : value,
              ),
              onChange: (e: { target: { value: string } }) =>
                onWebChange(e.target.value),
              style: {
                width: '100%',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: colors.ink,
                fontFamily: fonts.sans,
                fontSize: 16,
                lineHeight: '22px',
                padding: 0,
                margin: 0,
              },
            })}
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          disabled={!editable}
          onPress={openPicker}
          style={[
            styles.field,
            open && styles.fieldFocused,
            !!error && styles.fieldError,
            !editable && styles.disabled,
          ]}
        >
          <View style={styles.inner}>
            <Text style={[styles.label, open && styles.labelFocused]}>
              {label}
            </Text>
            <Text style={styles.value}>{formatScheduled(value)}</Text>
          </View>
        </Pressable>
      )}
      {error ? (
        <Text
          style={styles.error}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {error}
        </Text>
      ) : null}

      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={draft}
          mode="datetime"
          display="default"
          minimumDate={min}
          onChange={onAndroidChange}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal
          visible={open}
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
        >
          <Pressable
            style={styles.scrim}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Pressable
              style={styles.sheet}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={styles.sheetTitle}>When</Text>
              <View style={styles.pickerWell}>
                <DateTimePicker
                  value={draft}
                  mode="datetime"
                  display="spinner"
                  themeVariant="dark"
                  minimumDate={min}
                  onChange={onIosChange}
                  style={styles.iosPicker}
                />
              </View>
              <View style={styles.sheetActions}>
                <Button
                  variant="ghost"
                  onPress={() => {
                    commit(new Date());
                    setOpen(false);
                  }}
                >
                  Now
                </Button>
                <Button
                  onPress={() => {
                    commit(draft);
                    setOpen(false);
                  }}
                >
                  Done
                </Button>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
  },
  field: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.field,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  fieldFocused: {
    borderColor: colors.glassHighlight,
    backgroundColor: colors.fieldFocus,
  },
  fieldError: {
    borderColor: colors.danger,
  },
  disabled: {
    opacity: 0.55,
  },
  inner: {
    flex: 1,
    gap: 2,
    justifyContent: 'center',
  },
  label: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  labelFocused: {
    color: colors.accent,
  },
  value: {
    ...type.body,
    color: colors.ink,
  },
  error: {
    ...type.caption,
    color: colors.danger,
    paddingLeft: space.sm,
  },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.canvasLift,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: space.lg,
    paddingBottom: space.xl,
    paddingHorizontal: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  sheetTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: space.sm,
  },
  pickerWell: {
    overflow: 'hidden',
    borderRadius: radius.control,
    backgroundColor: colors.canvasDeep,
  },
  iosPicker: {
    alignSelf: 'stretch',
    backgroundColor: colors.canvasDeep,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.md,
  },
});
