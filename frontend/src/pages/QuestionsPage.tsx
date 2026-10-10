import { ComingSoon } from './ComingSoon';

export default function QuestionsPage() {
  return (
    <ComingSoon
      title="Questions"
      milestone="M2"
      points={[
        'Pick a table, add joins suggested from foreign keys, filter, summarise and sort — no SQL needed.',
        'See the generated SQL at any time, or convert the question to SQL.',
        'Save questions into collections and chart them (M3, M4).',
      ]}
    />
  );
}
