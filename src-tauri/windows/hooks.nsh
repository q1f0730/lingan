; v0.33 0518「发送到 → 拾穗」：装好后在当前用户的「发送到」菜单放一个快捷方式，带 --send 参数；卸载时删掉
!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$SENDTO\拾穗 Glean.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--send" "$INSTDIR\${MAINBINARYNAME}.exe" 0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$SENDTO\拾穗 Glean.lnk"
!macroend
