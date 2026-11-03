import { Box, Flex, IconButton, Menu, MenuButton, MenuDivider, MenuItem, MenuList, Text, Tooltip } from '@chakra-ui/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckIcon } from '../icons';
import { AppsIcon, BarChartIcon, KanbanIcon } from '../kanban/icons';
import { t } from '../i18n/index.ts';
import { LAUNCHER_PATH, SERVICE_GRADIENT, SERVICE_HOME, saveService, serviceOf } from './service';
import type { Service } from './service';

export function ServiceMark({ service, size = 28 }: { service: Service; size?: number }) {
  const Icon = service === 'bi' ? BarChartIcon : KanbanIcon;
  return (
    <Flex w={`${size}px`} h={`${size}px`} flexShrink={0} align="center" justify="center" borderRadius="lg" bgGradient={SERVICE_GRADIENT[service]} color="white">
      <Icon boxSize={`${Math.round(size * 0.55)}px`} />
    </Flex>
  );
}

/** A small menu for jumping between Ncode Search & BI and Ncode - Kanban (remembers the choice). */
export function ServiceSwitcher({ placement = 'bottom-start' }: { placement?: 'bottom-start' | 'bottom-end' | 'right-start' }) {
  const navigate = useNavigate();
  const current = serviceOf(useLocation().pathname);
  const go = (service: Service) => {
    saveService(service);
    navigate(SERVICE_HOME[service]);
  };
  const items: { service: Service; name: string; hint: string }[] = [
    { service: 'bi', name: t('Ncode Search & BI'), hint: t('Search, questions and dashboards') },
    { service: 'kanban', name: t('Ncode - Kanban'), hint: t('Boards and cards for the team') },
  ];
  return (
    <Menu placement={placement} isLazy>
      <Tooltip label={t('Switch between Search & BI and Kanban')} hasArrow openDelay={300}>
        <MenuButton as={IconButton} aria-label={t('Switch service')} size="sm" variant="ghost" icon={<AppsIcon boxSize={4} />} data-testid="service-switcher" />
      </Tooltip>
      <MenuList zIndex={1600} minW="270px">
        {items.map((it) => (
          <MenuItem key={it.service} onClick={() => go(it.service)} data-testid={`service-${it.service}`}>
            <Flex align="center" gap={3} w="100%">
              <ServiceMark service={it.service} />
              <Box flex={1} minW={0}>
                <Text fontSize="sm" fontWeight={600}>
                  {it.name}
                </Text>
                <Text fontSize="xs" color="mutedText" noOfLines={1}>
                  {it.hint}
                </Text>
              </Box>
              {current === it.service && <CheckIcon boxSize={4} color="brand.300" />}
            </Flex>
          </MenuItem>
        ))}
        <MenuDivider />
        <MenuItem icon={<AppsIcon boxSize={4} />} onClick={() => navigate(LAUNCHER_PATH)} fontSize="sm" data-testid="service-launcher">
          {t('All services')}
        </MenuItem>
      </MenuList>
    </Menu>
  );
}
