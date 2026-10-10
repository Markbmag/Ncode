import type { ColumnType } from '../api';
import type { FilterOp } from './types.ts';

/** What kind of value input an operator needs in the filter editor. */
export type ValueKind = 'none' | 'single' | 'pair' | 'list' | 'relative' | 'current';

export interface OperatorInfo {
  op: FilterOp;
  label: string;
  value: ValueKind;
}

const O = (op: FilterOp, label: string, value: ValueKind): OperatorInfo => ({ op, label, value });

const EMPTY = [O('is_null', 'is empty (null)', 'none'), O('not_null', 'is not empty (null)', 'none')];

export const OPERATORS: Record<'string' | 'number' | 'date' | 'boolean' | 'other', OperatorInfo[]> = {
  string: [
    O('=', 'is', 'single'),
    O('!=', 'is not', 'single'),
    O('contains', 'contains', 'single'),
    O('not_contains', 'does not contain', 'single'),
    O('starts_with', 'starts with', 'single'),
    O('ends_with', 'ends with', 'single'),
    O('in', 'is one of', 'list'),
    O('not_in', 'is none of', 'list'),
    O('is_empty', 'is empty or blank', 'none'),
    O('not_empty', 'has a value', 'none'),
    ...EMPTY,
  ],
  number: [
    O('=', '=', 'single'),
    O('!=', '≠', 'single'),
    O('>', '>', 'single'),
    O('>=', '≥', 'single'),
    O('<', '<', 'single'),
    O('<=', '≤', 'single'),
    O('between', 'between', 'pair'),
    O('in', 'is one of', 'list'),
    O('not_in', 'is none of', 'list'),
    ...EMPTY,
  ],
  date: [
    O('last', 'in the last', 'relative'),
    O('current', 'this', 'current'),
    O('between', 'between', 'pair'),
    O('>=', 'on or after', 'single'),
    O('<', 'before', 'single'),
    O('=', 'on', 'single'),
    ...EMPTY,
  ],
  boolean: [O('is_true', 'is true', 'none'), O('is_false', 'is false', 'none'), ...EMPTY],
  other: [O('=', 'is', 'single'), O('!=', 'is not', 'single'), ...EMPTY],
};

export function operatorGroup(type: ColumnType): keyof typeof OPERATORS {
  if (type === 'string') return 'string';
  if (type === 'number') return 'number';
  if (type === 'date' || type === 'datetime') return 'date';
  if (type === 'boolean') return 'boolean';
  if (type === 'unknown') return 'string';
  return 'other';
}

export function operatorsFor(type: ColumnType): OperatorInfo[] {
  return OPERATORS[operatorGroup(type)];
}

export function operatorInfo(type: ColumnType, op: FilterOp): OperatorInfo {
  return operatorsFor(type).find((o) => o.op === op) ?? O(op, op, 'single');
}

/** The value a new condition starts with after picking an operator. */
export function defaultValue(kind: ValueKind): unknown {
  switch (kind) {
    case 'pair':
      return ['', ''];
    case 'list':
      return [];
    case 'relative':
      return { amount: 30, unit: 'day', include_current: false };
    case 'current':
      return { unit: 'month' };
    case 'none':
      return undefined;
    default:
      return '';
  }
}

/** True when the condition has everything it needs to be sent. */
export function valueComplete(kind: ValueKind, value: unknown): boolean {
  switch (kind) {
    case 'none':
    case 'relative':
    case 'current':
      return true;
    case 'pair':
      return Array.isArray(value) && value.length === 2 && value.every((v) => String(v ?? '').trim() !== '');
    case 'list':
      return Array.isArray(value) && value.length > 0;
    default:
      return value !== undefined && value !== null && String(value).trim() !== '';
  }
}
