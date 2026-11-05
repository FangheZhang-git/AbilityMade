const {defineConfig,devices}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'./browser-tests',fullyParallel:false,workers:1,
  use:{baseURL:'http://127.0.0.1:3187'},
  webServer:{command:'node server.js',url:'http://127.0.0.1:3187',reuseExistingServer:false,env:{PORT:'3187',STRIPE_SECRET_KEY:'',RESEND_API_KEY:''}},
  projects:[{name:'desktop-chromium',use:{...devices['Desktop Chrome']}},{name:'mobile-chromium',use:{...devices['Pixel 7']}},{name:'mobile-webkit',use:{...devices['iPhone 13']}}],
});
