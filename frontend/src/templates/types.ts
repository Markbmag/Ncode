/** Dashboard templates for manufacturing (M15, backend app/templates_mfg.py). */
import type { TaskSnapshot } from '../query/useQueryRun';
import type { VizState } from '../viz/state';

export type RoleKind = 'table' | 'number' | 'date' | 'label' | 'value';

export interface TemplateRole {
  key: string;
  kind: RoleKind;
  ask: string;           // "Which column is the duration in minutes?"
  help: string | null;
  table: string | null;  // column roles: the table role they belong to
  required: boolean;
  default: number | null;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  roles: TemplateRole[];
}

/** role key -> table name, "table.column" or a number */
export type Mapping = Record<string, string | number>;

export interface RoleOption {
  value: string;
  label: string;   // display names: "Downtime events → Duration, min"
  detail: string;  // the technical name, shown small
  good: boolean;   // a likely answer
}

export interface Suggestion {
  mapping: Mapping;
  suggested: string[];
  options: Record<string, RoleOption[]>;
  lacking: string[];       // questions still to answer
  error: string | null;    // the mapping does not fit (a text column for minutes ...)
  complete: boolean;
}

export interface TemplatePlan {
  name: string;
  description: string;
  questions: { key: string; name: string; description: string; kind: 'builder' | 'federated' }[];
  cards: { key: string; kind: string; title: string | null }[];
  missing: { name: string; reason: string }[];
  preview: { card: string; name: string; viz: VizState; task: TaskSnapshot };
}

export interface Created {
  dashboard: { id: number; name: string; collection_id: number };
  questions: number[];
  missing: { name: string; reason: string }[];
}
