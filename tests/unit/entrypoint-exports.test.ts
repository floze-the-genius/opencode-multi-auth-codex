describe('plugin entrypoint exports', () => {
  it('only exposes the default plugin function', async () => {
    const mod = await import('../../src/index.js')

    expect(Object.keys(mod).sort()).toEqual(['default'])
  })
})
