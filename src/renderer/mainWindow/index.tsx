import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import bootstrapMainWindow from '../bootstrap/mainWindow';
import router from './router';

document.body.dataset.window = 'main';
// 平台标记：供样式按平台调整窗口 chrome（如 macOS 红绿灯留白）
document.body.dataset.platform = window.globalContext.platform;

const container = document.getElementById('root');
if (!container) {
    throw new Error('Root element not found');
}

const root = createRoot(container);

bootstrapMainWindow().then(() => {
    root.render(
        <React.StrictMode>
            <RouterProvider router={router} />
        </React.StrictMode>,
    );
});
