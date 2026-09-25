const count = document.getElementById('count')
document.getElementById('plus').addEventListener('click', () => {
  count.textContent = String(Number(count.textContent) + 1)
})
