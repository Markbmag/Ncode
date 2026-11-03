import { Flex, Spinner } from '@chakra-ui/react';

export function PageSpinner() {
  return (
    <Flex minH="100vh" align="center" justify="center">
      <Spinner color="brand.300" size="xl" />
    </Flex>
  );
}
