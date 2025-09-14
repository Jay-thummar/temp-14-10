import { useState } from 'react'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'

export function Home() {
  const [q, setQ] = useState('')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    // Navigate to search route later
    // placeholder
    alert(`Search: ${q}`)
  }
  return (
    <Stack spacing={3}>
      <Typography variant="h5">Find the best price</Typography>
      <Box component="form" onSubmit={submit}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField fullWidth value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search products (e.g., iPhone 13)" />
          <Button variant="contained" type="submit">Search</Button>
        </Stack>
      </Box>
    </Stack>
  )
}

