import { createBrowserRouter } from 'react-router'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { InquiryPage } from './pages/InquiryPage'
import { LegalPage } from './pages/LegalPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ThanksPage } from './pages/ThanksPage'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/anfrage', element: <InquiryPage /> },
      { path: '/danke', element: <ThanksPage /> },
      { path: '/impressum', element: <LegalPage kind="impressum" /> },
      { path: '/datenschutz', element: <LegalPage kind="datenschutz" /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
