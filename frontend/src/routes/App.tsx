import { Outlet } from 'react-router-dom'
import { AppBar, Box, Container, IconButton, Toolbar, Typography } from '@mui/material'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'

export function App() {
  return (
    <Box>
      <AppBar position="static">
        <Toolbar>
          <ShoppingCartIcon sx={{ mr: 1 }} />
          <Typography variant="h6" sx={{ flexGrow: 1 }}>Price Comparison</Typography>
        </Toolbar>
      </AppBar>
      <Container sx={{ py: 2 }}>
        <Outlet />
      </Container>
    </Box>
  )
}

