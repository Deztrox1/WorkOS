import type { CapacitorConfig } from '@capacitor/cli';

// Web target only. No android/ios platform is added in v1 (PRD section 1).
const config: CapacitorConfig = {
  appId: 'com.example.workos',
  appName: 'WorkOS',
  webDir: 'dist',
};

export default config;
