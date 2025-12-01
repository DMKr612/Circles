import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.circles.app', // You can change this ID later
  appName: 'Circles',
  webDir: 'dist', // <--- THIS FIXES YOUR ERROR (Vite uses 'dist', not 'www')
  server: {
    androidScheme: 'https'
  }
};

export default config;