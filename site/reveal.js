const DEBUG = new URLSearchParams(location.search).has('reveal-debug')
const log = (...args) => DEBUG && console.log('[reveal]', ...args)

log('UA:', navigator.userAgent)
log('CSS.supports(animation-timeline, view()):', CSS.supports('animation-timeline', 'view()'))

const reveals = document.querySelectorAll('.reveal');
log('found', reveals.length, '.reveal elements');

requestAnimationFrame(() => {
  log('requestAnimationFrame fired, starting observer');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      log('callback:', entry.target.tagName, entry.target.className, entry.target.id || '(no id)', 'intersecting:', entry.isIntersecting, 'ratio:', entry.intersectionRatio);
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        log('added is-visible to:', entry.target.tagName, entry.target.id || '(no id)');
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '-50px 0px -50px 0px' });
  reveals.forEach(el => observer.observe(el));
  log('observer started, observing', reveals.length, 'elements');
});
