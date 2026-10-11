import { useRef, useState } from 'react';
import {
  Box, Button, Checkbox, FormControl, FormHelperText, FormLabel, HStack, Input, Progress, Select, SimpleGrid, Text,
} from '@chakra-ui/react';
import { CollectionPicker, DialogShell } from '../library/dialogs';
import { useCollections } from '../library/api';
import { UploadIcon } from '../icons';
import { useWorkspace } from '../workspace/useWorkspace';
import { datasets, formatBytes } from './api';
import type { UploadOptions } from './api';
import type { Dataset } from './types';

const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xlsm,.parquet';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUploaded?: (d: Dataset) => void;
  collectionId?: number | null;
}

/** Upload a CSV / Excel / Parquet file; it becomes a dataset (a source for multi-source questions). */
export function UploadDialog({ isOpen, onClose, onUploaded, collectionId = null }: Props) {
  return isOpen ? <UploadForm onClose={onClose} onUploaded={onUploaded} collectionId={collectionId} /> : null;
}

function UploadForm({ onClose, onUploaded, collectionId }: { onClose: () => void; onUploaded?: (d: Dataset) => void; collectionId: number | null }) {
  const ws = useWorkspace();
  const { data } = useCollections();
  const input = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<number | null>(collectionId);
  const [delimiter, setDelimiter] = useState<NonNullable<UploadOptions['delimiter']>>('auto');
  const [encoding, setEncoding] = useState<NonNullable<UploadOptions['encoding']>>('utf-8');
  const [header, setHeader] = useState(true);
  const [sheet, setSheet] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const collection = picked ?? data?.personal_id ?? null;
  const ext = file?.name.split('.').pop()?.toLowerCase() ?? '';
  const isText = ['csv', 'tsv', 'txt'].includes(ext);
  const isExcel = ['xlsx', 'xlsm'].includes(ext);
  const maxMb = ws.limits.dataset_max_mb ?? 100;
  const tooBig = !!file && file.size > maxMb * 1024 * 1024;

  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title="Upload a file"
      submitLabel="Upload"
      size="lg"
      canSubmit={!!file && !tooBig && collection !== null}
      onSubmit={async () => {
        if (!file) return;
        setProgress(0);
        try {
          const d = await datasets.upload(
            file,
            {
              name: name.trim() || undefined,
              collection_id: collection,
              ...(isText ? { delimiter: ext === 'tsv' && delimiter === 'auto' ? 'tab' : delimiter, encoding, header } : {}),
              ...(isExcel ? { header, sheet: sheet.trim() || undefined } : {}),
            },
            setProgress,
          );
          onUploaded?.(d);
        } finally {
          setProgress(null);
        }
      }}
    >
      <Box
        border="2px dashed"
        borderColor={file ? 'brand.400' : 'lineColor'}
        borderRadius="lg"
        p={5}
        textAlign="center"
        cursor="pointer"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) setFile(f);
        }}
      >
        <UploadIcon boxSize={6} color="brand.400" />
        <Text fontSize="sm" mt={2} fontWeight={600}>
          {file ? `${file.name} · ${formatBytes(file.size)}` : 'Drop a file here or click to choose'}
        </Text>
        <Text fontSize="xs" color="faintText">
          CSV, TSV, Excel (.xlsx) or Parquet · up to {maxMb} MB and {(ws.limits.dataset_max_rows ?? 1_000_000).toLocaleString()} rows
        </Text>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          data-testid="upload-input"
        />
      </Box>
      {tooBig && (
        <Text fontSize="sm" color="red.400">
          The file is larger than {maxMb} MB.
        </Text>
      )}
      <FormControl>
        <FormLabel fontSize="sm">Name</FormLabel>
        <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} placeholder={file ? file.name.replace(/\.[^.]+$/, '') : 'the file name'} maxLength={200} />
      </FormControl>
      <FormControl>
        <FormLabel fontSize="sm">Collection</FormLabel>
        <CollectionPicker value={collection} onChange={setPicked} />
        <FormHelperText fontSize="xs">People who can see the collection can use the file's rows.</FormHelperText>
      </FormControl>
      {(isText || isExcel) && (
        <SimpleGrid columns={{ base: 1, sm: 3 }} spacing={3}>
          {isText && (
            <>
              <FormControl>
                <FormLabel fontSize="xs">Separator</FormLabel>
                <Select size="sm" value={delimiter} onChange={(e) => setDelimiter(e.target.value as typeof delimiter)}>
                  <option value="auto">Detect</option>
                  <option value="comma">Comma ,</option>
                  <option value="semicolon">Semicolon ;</option>
                  <option value="tab">Tab</option>
                  <option value="pipe">Pipe |</option>
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel fontSize="xs">Encoding</FormLabel>
                <Select size="sm" value={encoding} onChange={(e) => setEncoding(e.target.value as typeof encoding)}>
                  <option value="utf-8">UTF-8</option>
                  <option value="latin-1">Latin-1 (Windows)</option>
                  <option value="utf-16">UTF-16</option>
                </Select>
              </FormControl>
            </>
          )}
          {isExcel && (
            <FormControl>
              <FormLabel fontSize="xs">Sheet</FormLabel>
              <Input size="sm" value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder="the first one" />
            </FormControl>
          )}
          <FormControl display="flex" alignItems="flex-end">
            <Checkbox size="sm" isChecked={header} onChange={(e) => setHeader(e.target.checked)}>
              First row has the column names
            </Checkbox>
          </FormControl>
        </SimpleGrid>
      )}
      {progress !== null && (
        <HStack>
          <Progress value={progress * 100} size="sm" flex={1} borderRadius="full" isIndeterminate={progress >= 1} />
          <Text fontSize="xs" color="mutedText" w="120px">
            {progress >= 1 ? 'Reading the file…' : `${Math.round(progress * 100)} %`}
          </Text>
        </HStack>
      )}
      {!file && (
        <Button size="sm" variant="subtle" leftIcon={<UploadIcon boxSize={4} />} onClick={() => input.current?.click()} alignSelf="flex-start">
          Choose a file
        </Button>
      )}
    </DialogShell>
  );
}
