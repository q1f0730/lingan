// Framer Motion 的动画特性（进出场、弹簧、AnimatePresence）。由 LazyMotion 在首屏之后异步加载，不进首包。
// v0.34：layoutId 共享布局动画（domMax，多约 46KB）换成了自写的 Glide 滑块，这里只要 domAnimation。
import { domAnimation } from 'framer-motion';
export default domAnimation;
