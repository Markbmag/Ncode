import { useState } from 'react';
import { FormControl, FormLabel, Input, Text } from '@chakra-ui/react';
import { DialogShell } from '../library/dialogs';
import { subscriptions } from './api';

/** Your own email address: subscriptions and alerts sent to you go there. */
export function AccountEmailDialog({ current, onClose, onSaved }: { current: string | null; onClose: () => void; onSaved: (email: string | null) => void }) {
  const [email, setEmail] = useState(current ?? '');
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title="Your email address"
      submitLabel="Save"
      onSubmit={async () => onSaved(await subscriptions.setMyEmail(email.trim()))}
    >
      <Text fontSize="sm" color="mutedText">
        Subscriptions and alerts that include you are sent to this address. Nobody else sees it.
      </Text>
      <FormControl>
        <FormLabel fontSize="sm">Email</FormLabel>
        <Input size="sm" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus data-testid="account-email" />
      </FormControl>
    </DialogShell>
  );
}
