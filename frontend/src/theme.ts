import { extendTheme } from '@chakra-ui/react';
import type { ThemeConfig } from '@chakra-ui/react';

const config: ThemeConfig = {
  initialColorMode: 'dark',
  useSystemColorMode: false,
};

const fontStack = "'Inter', 'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif";

export const theme = extendTheme({
  config,
  fonts: {
    heading: fontStack,
    body: fontStack,
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace",
  },
  colors: {
    brand: {
      50: '#eef2ff',
      100: '#e0e7ff',
      200: '#c7d2fe',
      300: '#a5b4fc',
      400: '#818cf8',
      500: '#6366f1',
      600: '#4f46e5',
      700: '#4338ca',
      800: '#3730a3',
      900: '#312e81',
    },
  },
  semanticTokens: {
    colors: {
      appBg: { default: '#f4f5fa', _dark: '#0a0f1e' },
      sidebarBg: { default: '#ffffff', _dark: '#0d1324' },
      panelBg: { default: '#ffffff', _dark: '#131b30' },
      panelHover: { default: '#f3f4fb', _dark: '#1a2442' },
      chipBg: { default: '#eceefb', _dark: 'rgba(255, 255, 255, 0.07)' },
      lineColor: { default: '#e3e5f0', _dark: 'rgba(255, 255, 255, 0.10)' },
      bodyText: { default: '#1b2036', _dark: '#e6e9f5' },
      mutedText: { default: '#5b6280', _dark: '#9aa3c2' },
      faintText: { default: '#8a91ad', _dark: '#6b7494' },
      matchBg: { default: '#fde68a', _dark: 'rgba(250, 204, 21, 0.26)' },
      matchText: { default: '#1b2036', _dark: '#fef3c7' },
    },
  },
  styles: {
    global: {
      'html, body, #root': { height: '100%' },
      body: { bg: 'appBg', color: 'bodyText', fontFeatureSettings: "'cv11', 'ss01'", WebkitFontSmoothing: 'antialiased' },
      '::selection': { background: 'rgba(99, 102, 241, 0.35)' },
    },
  },
  components: {
    Button: {
      baseStyle: { fontWeight: 600, borderRadius: 'lg' },
      variants: {
        brand: {
          bg: 'brand.500',
          color: 'white',
          _hover: { bg: 'brand.600', _disabled: { bg: 'brand.500' } },
          _active: { bg: 'brand.700' },
        },
        subtle: {
          bg: 'chipBg',
          color: 'bodyText',
          _hover: { bg: 'panelHover', _disabled: { bg: 'chipBg' } },
          _active: { bg: 'panelHover' },
        },
      },
      defaultProps: { variant: 'brand' },
    },
    IconButton: {
      defaultProps: { variant: 'subtle' },
    },
    Input: {
      variants: {
        outline: {
          field: {
            bg: 'panelBg',
            borderColor: 'lineColor',
            borderRadius: 'lg',
            _hover: { borderColor: 'brand.300' },
            _focusVisible: { borderColor: 'brand.400', boxShadow: '0 0 0 3px rgba(99, 102, 241, 0.25)' },
          },
        },
      },
    },
    Select: {
      variants: {
        outline: {
          field: {
            bg: 'panelBg',
            borderColor: 'lineColor',
            borderRadius: 'lg',
            _hover: { borderColor: 'brand.300' },
            _focusVisible: { borderColor: 'brand.400', boxShadow: '0 0 0 3px rgba(99, 102, 241, 0.25)' },
          },
        },
      },
    },
    Modal: {
      baseStyle: {
        dialog: { bg: 'panelBg', borderRadius: '2xl', border: '1px solid', borderColor: 'lineColor' },
      },
    },
    Drawer: {
      baseStyle: {
        dialog: { bg: 'panelBg' },
      },
    },
    Menu: {
      baseStyle: {
        list: { bg: 'panelBg', borderColor: 'lineColor', borderRadius: 'xl', boxShadow: 'xl', py: 2 },
        item: { bg: 'transparent', _hover: { bg: 'panelHover' }, _focus: { bg: 'panelHover' } },
      },
    },
    Popover: {
      baseStyle: {
        content: { bg: 'panelBg', borderColor: 'lineColor', borderRadius: 'xl', boxShadow: 'xl' },
      },
    },
    Tooltip: {
      baseStyle: { borderRadius: 'md', fontSize: 'xs', px: 2.5, py: 1.5 },
    },
  },
});
