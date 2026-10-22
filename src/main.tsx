import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { startThumbJob } from './lib/thumbjob';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// v0.13：首屏之后在空闲时补缩略图（旧图迁移、新图入库）
startThumbJob();
