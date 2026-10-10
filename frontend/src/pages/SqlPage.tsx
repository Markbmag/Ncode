import { ComingSoon } from './ComingSoon';

export default function SqlPage() {
  return (
    <ComingSoon
      title="SQL editor"
      milestone="M2"
      points={[
        'Read-only SQL checked by a real SQL parser (M1), with row limits and timeouts.',
        'Autocomplete from the database schema, Ctrl/Cmd+Enter to run, {{parameters}}.',
        'Results as a table or a chart.',
      ]}
    />
  );
}
