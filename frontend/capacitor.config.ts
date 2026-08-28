import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.omnipunt.app',
  appName: 'OmniPunt',
  webDir: 'dist',
  server: {
    // O app roda o bundle local; a API continua remota em api.omnipunt.com.
    androidScheme: 'https',
  },
  ios: { contentInset: 'always' },
}

export default config
