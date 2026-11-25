window.__ModuleLoader__.load({
  id: 'dsh-collab',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-collab/api'
    const POLL_MS = 2000

    const TEXT = {
      idleTitle: '协作室 · 未开启',
      idleHint: '开启后把邀请链接或二维码给朋友，每个人的研究进度会实时汇总到这里。',
      open: '开启协作',
      close: '收起',
      name: '你的显示名',
      create: '创建协作室',
      lab: '本机实验（起 2 个模拟成员）',
      labOn: '本机实验运行中',
      labStop: '停止实验',
      joinTitle: '加入别人的协作室',
      joinHint: '把邀请链接 / 二维码文本粘到下面，或手工填 relay 与邀请码。',
      paste: '粘贴邀请链接或二维码文本',
      relay: 'Relay 地址（必填，形如 https://域名/dsh-collab/relay）',
      code: '邀请码',
      join: '加入',
      leave: '离开',
      copy: '复制邀请',
      copyLink: '复制链接',
      copied: '已复制',
      invite: '邀请码',
      relayLabel: 'Relay',
      members: '成员',
      messages: '协作消息',
      send: '发送',
      placeholder: '说点什么给房间里的人…',
      emptyMembers: '还没有其他成员。',
      emptyMessages: '还没有消息。',
      running: '研究中',
      idle: '空闲',
      tokens: 'token',
      noSession: '还没开协作模式会话（标准模式的会话不会出现在客厅）',
      scanHint: '手机扫码，或把链接发给朋友（他在自己的 DSH 里打开会自动带出邀请码）。',
      loopbackBlocked:
        '注意：你的 DSH 现在只监听 127.0.0.1，任何人（同局域网 / Tailscale 上的队友）都连不进来。先做一次入口：tailscale serve --bg <端口>（或 funnel），把得到的 https 地址填进「固定地址」并保存；也可以用独立 relay（scripts/relay-server.mjs）并把它的地址填进去。',
      loopbackWarning:
        '这台机器没有局域网 IPv4，邀请地址是 127.0.0.1：只有同一台电脑上的 DSH 能加入。要跨机器请让 DSH 监听局域网地址后重进本面板。',
      lanHint: '朋友要在他自己的 DSH 里加入时，relay 地址用上面这个（你的局域网地址）。',
      fromLink: '已从邀请链接带出信息，确认名字后点「加入」。',
      tunnelOn: '开启公网 invitation（跨网段）',
      tunnelOnLabel: '公网邀请',
      tunnelStop: '关闭公网隧道',
      tunnelIdle: '未开公网隧道：只能同网段或本机加入',
      tunnelStarting: '隧道启动中（cloudflared 正在向 Cloudflare 取地址）…',
      tunnelError: '隧道启动失败：',
      tunnelHint: '公网隧道已开启：朋友在任何网络、任何机器上都能用这个链接加入（隧道随 DSH 关闭失效）。',
      projectLabel: '项目',
      stepRelay: '第 0 步 · 中继（已内置团队地址，通常不用改）',
      relayPlaceholder: '中继地址（留空则用内置团队中继）',
      relaySave: '保存中继',
      relaySaved: '已保存：以后加入别人的房间只需要房间号',
      relayDefault: '使用内置团队中继',
      roomCodePlaceholder: '输入房间号，例如 3LMMJQ',
      findRoom: '查找',
      roomFound: '找到房间',
      roomJoin: '进入客厅',
      openForSession: '为这个会话开协作室',
      listRooms: '看看有哪些房间',
      roomsEmpty: '中继上还没有别的房间',
      roomsHint: '点房间后面的「加入」就能进同一间房（这个会话会切过去）',
      joinThisRoom: '加入',
      roomOpened: '这个会话的协作室已建好，把房间号发给队友',
      joinedRoom: '已加入，这个会话现在和队友共享',
      sessionRoomOnly: '这个会话是「协作模式」：它有自己的房间，和别的会话互不影响。',
      sessionRoomBound: '✓ 这个会话绑定了房间，进度与成果正在共享给房间里的人',
      roomPending: '房间已绑定，正在连接中继…',
      advanced: '高级：手工填 relay / 粘贴邀请链接 / 二维码文本',
      livingRoom: '客厅（共享：成员 · 进度 · 资料 · 消息）',
      sharedHint: '✓ 当前会话是「协作模式」，正在客厅共享',
      notSharedHint: '当前会话不在协作模式：它的内容和进度只在本机，不会进客厅。要一起干活就新建一个协作模式会话。',
      newCollabSession: '新建协作会话（协作模式）',
      newCollabFail: '这个版本没有一键新建会话的接口，请手动新建会话并在模式里选「协作模式」',
      myDesk: '我的工作区（私有：这里的问答只在我这台机器上）',
      shareTranscriptOff: '问答分离中：只共享「做了什么」和交付的文件',
      shareTranscriptOn: '正在共享我的输出片段（会显示给房间成员）',
      shareTranscriptToggle: '共享输出片段',
      stepCreate: '第 1 步 · 创建协作室（或用房间号进入别人的）',
      collabOnlyNote: '客厅只收「协作模式」的会话：普通会话的内容与进度只留在本机。',
      createHint: '创建后会立刻生成：二维码 + 邀请链接 + 6 位随机邀请码，都在下面这个面板里。',
      inviteStep: '第 2 步 · 把这个发给朋友（扫二维码 / 发链接 / 发邀请码都行）',
      relayInviteHint: '这个二维码指向中继的加入说明页：朋友扫码或点链接就知道该往自己的 DSH 里填什么。',
      localBoard: '本机看板（不加入任何房间也能看自己）',
      publicPlaceholder: '固定地址：https://你的域名（Tailscale Funnel / nginx / 固定隧道）',
      publicSave: '保存地址',
      publicCheck: '检测',
      publicSaved: '固定地址已保存：邀请链接会一直用它',
      publicOk: '固定地址可达，邀请链接可以直接发人',
      publicBad: '这个地址现在打不通，检查 Funnel / 反代 / 端口',
      share: '分享成果',
      sharePlaceholder: '把本机文件路径贴这里，推到房间里给队友看（≤32KB 文本）',
      roomTotal: '房间合计',
    }

    function fmtTokens(n) {
      const v = Number(n) || 0
      if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
      if (v >= 1000) return (v / 1000).toFixed(1) + 'k'
      return String(v)
    }

    function fmtBytes(n) {
      const v = Number(n) || 0
      if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + 'MB'
      if (v >= 1024) return (v / 1024).toFixed(1) + 'KB'
      return v + 'B'
    }

    function timeAgo(at) {
      const diff = Date.now() - (Number(at) || 0)
      if (!Number.isFinite(diff) || diff < 0) return ''
      if (diff < 60_000) return '刚刚'
      if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前'
      return Math.floor(diff / 3_600_000) + ' 小时前'
    }

    /** 从邀请链接 / 二维码文本里提取 relay 与邀请码。 */
    function parseInvite(text) {
      const raw = String(text || '').trim()
      if (!raw) return null
      try {
        const url = new URL(raw)
        const code = url.searchParams.get('collab') || url.searchParams.get('code') || url.searchParams.get('c')
        const relay = url.searchParams.get('relay') || url.searchParams.get('r')
        if (code) {
          // 看板页 /dsh-collab/watch?c=CODE、落地页 /dsh-collab/join?c=CODE，
          // 以及 relay 的根地址，都能从 URL 本身推出 relay 该填什么。
          const derived =
            relay ||
            (/^\/dsh-collab\//.test(url.pathname) || url.pathname === '/' ? url.origin + '/dsh-collab/relay' : undefined)
          return { code: String(code).toUpperCase(), relay: derived }
        }
        if (/^\/dsh-collab\/relay\/?$/.test(url.pathname)) {
          return { code: undefined, relay: url.origin + '/dsh-collab/relay' }
        }
      } catch {
        /* 不是 URL，继续按文本解析 */
      }
      const relayMatch = /relay\s*[:=]\s*(\S+)/i.exec(raw)
      const codeMatch = /code\s*[:=]\s*([A-Z0-9]{4,12})/i.exec(raw)
      if (codeMatch) return { code: codeMatch[1].toUpperCase(), relay: relayMatch ? relayMatch[1] : undefined }
      if (/^[A-Z0-9]{4,12}$/i.test(raw)) return { code: raw.toUpperCase() }
      return null
    }

    /** 当前页 URL 里带的邀请参数（朋友点链接打开 DSH 时自动预填）。 */
    function inviteFromLocation() {
      try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('collab') || params.get('code')
        if (!code) return null
        return { code: String(code).toUpperCase(), relay: params.get('relay') || undefined }
      } catch {
        return null
      }
    }

    const S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0 4px' },
      bar: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #9aa0a6)' },
      dot: { width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto' },
      linkBtn: {
        marginLeft: 'auto',
        background: 'transparent',
        border: 'none',
        padding: '2px 4px',
        cursor: 'pointer',
        fontSize: 12,
        color: 'var(--dsw-alias-brand-primary, #4c8dff)',
        fontFamily: 'inherit',
      },
      card: {
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))',
        background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06))',
        borderRadius: 10,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      label: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #8b9096)' },
      input: {
        flex: '1 1 140px',
        minWidth: 120,
        padding: '6px 9px',
        fontSize: 12,
        color: 'var(--dsw-alias-label-primary, #e8eaed)',
        background: 'var(--dsw-alias-bg-base, rgba(0,0,0,.16))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))',
        borderRadius: 7,
        fontFamily: 'inherit',
        outline: 'none',
      },
      btn: {
        padding: '6px 12px',
        fontSize: 12,
        borderRadius: 7,
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))',
        background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12))',
        color: 'var(--dsw-alias-label-primary, #e8eaed)',
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      btnPrimary: {
        padding: '7px 14px',
        fontSize: 12.5,
        fontWeight: 600,
        borderRadius: 7,
        border: '1px solid var(--dsw-alias-brand-primary, #4c8dff)',
        background: 'var(--dsw-alias-bg-layer-2, rgba(76,141,255,.18))',
        color: 'var(--dsw-alias-label-primary, #e8eaed)',
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      btnWide: {
        width: '100%',
        padding: '9px 14px',
        fontSize: 13,
        fontWeight: 600,
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-brand-primary, #4c8dff)',
        background: 'var(--dsw-alias-bg-layer-2, rgba(76,141,255,.18))',
        color: 'var(--dsw-alias-label-primary, #e8eaed)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'center',
      },
      inviteBox: {
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        padding: 10,
        borderRadius: 10,
        border: '1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,.45))',
        background: 'var(--dsw-alias-bg-base, rgba(0,0,0,.18))',
      },
      step: { fontSize: 11.5, fontWeight: 700, color: 'var(--dsw-alias-label-secondary, #9aa0a6)', letterSpacing: '.02em' },
      code: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 22,
        letterSpacing: 5,
        color: 'var(--dsw-alias-brand-primary, #4c8dff)',
      },
      member: {
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.24))',
        borderRadius: 8,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.06))',
      },
      session: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary, #9aa0a6)',
        minWidth: 0,
      },
      ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      messages: { maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, padding: '2px' },
      msg: { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary, #e8eaed)', wordBreak: 'break-word' },
      msgMeta: { fontSize: 10, color: 'var(--dsw-alias-label-tertiary, #8b9096)', marginRight: 6 },
      error: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary, #e5534b)' },
      badge: {
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))',
        color: 'var(--dsw-alias-label-tertiary, #8b9096)',
      },
      warn: { fontSize: 11, color: 'var(--dsw-alias-state-warn-primary, #d29922)' },
      trail: {
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        marginLeft: 11,
        paddingLeft: 7,
        borderLeft: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))',
      },
      trailRow: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--dsw-alias-label-secondary, #9aa0a6)', minWidth: 0 },
      trailKind: {
        flex: '0 0 auto',
        fontSize: 9,
        padding: '0 4px',
        borderRadius: 4,
        background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.14))',
        color: 'var(--dsw-alias-label-tertiary, #8b9096)',
      },
      trailAt: { flex: '0 0 auto', fontSize: 9, color: 'var(--dsw-alias-label-tertiary, #8b9096)' },
      artifacts: { display: 'flex', flexWrap: 'wrap', gap: 4, marginLeft: 11 },
      artifact: {
        fontSize: 10.5,
        padding: '1px 7px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))',
        background: 'transparent',
        color: 'var(--dsw-alias-brand-primary, #4c8dff)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        maxWidth: 220,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      preview: {
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))',
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-base, rgba(0,0,0,.24))',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      },
      pre: {
        margin: 0,
        maxHeight: 260,
        overflow: 'auto',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        lineHeight: 1.45,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'var(--dsw-alias-label-primary, #e8eaed)',
      },
      popover: {
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))',
        background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06))',
        borderRadius: 10,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxHeight: '58vh',
        overflowY: 'auto',
        position: 'relative',
        zIndex: 30,
      },
      linkLine: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 0,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        padding: '5px 8px',
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-base, rgba(0,0,0,.2))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))',
        color: 'var(--dsw-alias-label-secondary, #9aa0a6)',
      },
      linkText: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      board: {
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.24))',
        borderRadius: 8,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.06))',
      },
      qrBox: { background: '#fff', padding: 8, borderRadius: 10, lineHeight: 0, flex: '0 0 auto' },
      linkBox: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        padding: '6px 8px',
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-base, rgba(0,0,0,.2))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))',
        wordBreak: 'break-all',
        color: 'var(--dsw-alias-label-secondary, #9aa0a6)',
      },
    }

    function QrCode({ qr, size }) {
      if (!qr || !qr.path) return null
      const dim = qr.dimension
      return h(
        'div',
        { style: S.qrBox },
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: `0 0 ${dim} ${dim}`,
            shapeRendering: 'crispEdges',
            role: 'img',
            'aria-label': '协作室邀请二维码',
          },
          h('rect', { width: dim, height: dim, fill: '#fff' }),
          h('path', { d: qr.path, fill: '#000' }),
        ),
      )
    }

    function CollabPanel(props) {
      const [snap, setSnap] = React.useState(null)
      const [expanded, setExpanded] = React.useState(false)
      const [name, setName] = React.useState('')
      const [relay, setRelay] = React.useState('')
      const [code, setCode] = React.useState('')
      const [paste, setPaste] = React.useState('')
      const [draft, setDraft] = React.useState('')
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [copied, setCopied] = React.useState('')
      const [preview, setPreview] = React.useState(null)
      const [sharePath, setSharePath] = React.useState('')
      const [publicBase, setPublicBase] = React.useState('')
      const [homeRelay, setHomeRelay] = React.useState('')
      const [roomCode, setRoomCode] = React.useState('')
      const [found, setFound] = React.useState(null)
      const [shareOut, setShareOut] = React.useState(false)
      const [roomList, setRoomList] = React.useState(null)
      const mounted = React.useRef(true)
      const prefilled = React.useRef(false)

      React.useEffect(() => {
        mounted.current = true
        let timer = null
        const load = async () => {
          try {
            const sid = props && props.sessionId ? String(props.sessionId) : ''
            const res = await fetch(API + '/state' + (sid ? '?session=' + encodeURIComponent(sid) : ''), { headers: { accept: 'application/json' } })
            if (!res.ok) throw new Error('state ' + res.status)
            const data = await res.json()
            if (!mounted.current) return
            setSnap(data)
            setError('')
            if (data && data.self && data.self.name && !name) setName(data.self.name)
            if (data && data.settings && data.settings.publicBaseUrl && !publicBase) setPublicBase(data.settings.publicBaseUrl)
            if (data && data.settings && data.settings.homeRelay && !homeRelay) setHomeRelay(data.settings.homeRelay)
            if (data && data.settings && typeof data.settings.shareTranscript === 'boolean') setShareOut(data.settings.shareTranscript)
            if (!prefilled.current) {
              const fromUrl = inviteFromLocation()
              if (fromUrl && data && data.mode === 'offline') {
                prefilled.current = true
                setCode(fromUrl.code)
                if (fromUrl.relay) setRelay(fromUrl.relay)
                setExpanded(true)
                setNotice(TEXT.fromLink)
              }
            }
          } catch (e) {
            if (mounted.current) setError('协作服务不可达：' + (e && e.message ? e.message : e))
          }
          if (mounted.current) timer = setTimeout(load, POLL_MS)
        }
        void load()
        return () => {
          mounted.current = false
          if (timer) clearTimeout(timer)
        }
      }, [])

      const call = async (path, body) => {
        setBusy(true)
        try {
          const res = await fetch(API + path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
              sessionMode && props && props.sessionId
                ? { ...(body || {}), sessionId: String(props.sessionId) }
                : body || {},
            ),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            setError(data && data.error ? data.error : '请求失败(' + res.status + ')')
            return null
          }
          setError('')
          const state = await fetch(API + '/state')
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
          if (state) setSnap(state)
          return data
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
          return null
        } finally {
          setBusy(false)
        }
      }

      const copy = async (text, tag) => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(tag)
          setTimeout(() => mounted.current && setCopied(''), 1500)
        } catch {
          setError('复制失败，请手工选中复制')
        }
      }

      // 会话级视图：只有「协作模式」会话才渲染任何东西
      const sessionMode = !!(snap && snap.mode === 'session')
      // 已为这个会话建过房间（有绑定）就一定要显示；只有既非协作模式、又没绑定的会话才完全隐藏
      if (sessionMode && !snap.isCollabSession && !snap.binding) return null

      const effective = sessionMode
        ? {
            mode: snap.binding ? 'host' : 'offline',
            sessionMode: true,
            isCollabSession: true,
            code: snap.binding ? snap.binding.code : '',
            invite: snap.invite,
            members: (snap.snap && snap.snap.members) || [],
            messages: (snap.snap && snap.snap.messages) || [],
            project: snap.session ? { name: snap.session.label } : null,
            lab: { running: false, members: [] },
            tunnel: null,
            settings: snap.settings,
            localSessions: [],
            bound: !!snap.binding,
          }
        : snap

      const mode = (effective && effective.mode) || 'offline'
      const active = mode === 'host' || mode === 'guest'
      const invite = effective && effective.invite
      const members = (effective && effective.members) || []
      const messages = (effective && effective.messages) || []
      const lab = (effective && effective.lab) || { running: false, members: [] }
      const tunnelInfo = (effective && effective.tunnel) || null

      // 当前会话是否在客厅里共享（只有协作模式的会话会出现在 members[自己].sessions）
      const selfMember = members.find((m) => m.self)
      const sharedIds = new Set(((selfMember && selfMember.sessions) || []).map((item) => item.id))
      const currentSessionId = props && props.sessionId ? String(props.sessionId) : ''
      const isShared = currentSessionId ? sharedIds.has(currentSessionId) : null

      const openArtifact = async (member, session, artifact) => {
        setPreview({ loading: true, title: artifact.title, path: artifact.path, text: '', note: artifact.note })
        try {
          const response = await fetch(
            `${API}/artifact?member=${encodeURIComponent(member.id)}&session=${encodeURIComponent(session.id)}&aid=${encodeURIComponent(artifact.id)}`,
          )
          const payload = await response.json().catch(() => null)
          if (!response.ok || !payload) throw new Error((payload && payload.error) || '取不到内容')
          if (!mounted.current) return
          setPreview({ loading: false, title: payload.title, path: payload.path, text: payload.text || '', note: payload.note, truncated: payload.truncated })
        } catch (error) {
          if (mounted.current) setPreview({ loading: false, title: artifact.title, path: artifact.path, text: '', note: String(error && error.message ? error.message : error) })
        }
      }
      const runningCount = members.reduce(
        (sum, m) => sum + ((m.sessions || []).filter((s) => s.status === 'running').length || 0),
        0,
      )
      const roomTokens = members.reduce(
        (sum, m) => sum + (m.sessions || []).reduce((x, s) => x + (s.tokensIn || 0) + (s.tokensOut || 0), 0),
        0,
      )

      const barColor = active
        ? runningCount > 0
          ? 'var(--dsw-alias-state-success-primary, #3fb950)'
          : 'var(--dsw-alias-brand-primary, #4c8dff)'
        : 'var(--dsw-alias-state-idle-primary, #8b9096)'
      const barText = !active
        ? TEXT.idleTitle
        : '协作室 ' +
          ((effective && effective.code) || '') +
          ' · ' +
          members.length +
          ' 人 · ' +
          runningCount +
          ' 个会话在跑 · ' +
          messages.length +
          ' 条消息'

      const doPaste = () => {
        const parsed = parseInvite(paste)
        if (!parsed) {
          setError('没从这段文本里认出邀请码')
          return
        }
        setError('')
        setCode(parsed.code)
        if (parsed.relay) setRelay(parsed.relay)
        setNotice('已从粘贴内容带出 relay 与邀请码')
        setPaste('')
      }

      const doJoin = async () => {
        const parsedCode = (code || '').trim().toUpperCase() || (parseInvite(paste) || {}).code
        const parsedRelay = (relay || '').trim() || (parseInvite(paste) || {}).relay
        if (!parsedCode) {
          setError('还需要邀请码（房主给的 6 位码）')
          return
        }
        if (!parsedRelay) {
          setError('还需要 Relay 地址：把房主给的邀请链接整段粘到上面的框，或手填 https://<房主的域名>/dsh-collab/relay')
          return
        }
        const finalRelay = String(parsedRelay).trim().replace(/\/+$/, '')
        const ok = await call('/join', { relay: finalRelay, code: parsedCode, name })
        if (ok) {
          setNotice('')
          setExpanded(true)
        }
      }

      return h(
        'div',
        { style: S.wrap, 'data-dsh-collab': 'panel' },
        h(
          'div',
          { style: S.bar },
          h('span', { style: { ...S.dot, background: barColor } }),
          h('span', { style: S.ellipsis }, barText),
          h('button', { type: 'button', style: S.linkBtn, onClick: () => setExpanded((v) => !v) }, expanded ? TEXT.close : TEXT.open),
        ),
        expanded
          ? h(
              'div',
              { style: S.popover },
              !active
                ? h(
                    React.Fragment,
                    null,
                    h('div', { style: S.label }, TEXT.idleHint),

                    h('div', { style: S.step }, TEXT.stepRelay),
                    h('div', { style: S.row, gap: 6 },
                      h('input', {
                        style: S.input,
                        placeholder: TEXT.relayPlaceholder,
                        value: homeRelay,
                        onChange: (e) => setHomeRelay(e.target.value),
                      }),
                      h('button', {
                        type: 'button',
                        style: S.btn,
                        disabled: busy || !homeRelay.trim(),
                        onClick: async () => {
                          const saved = await call('/settings', { homeRelay: homeRelay.trim() })
                          if (saved) setNotice(TEXT.relaySaved)
                        },
                      }, TEXT.relaySave),
                    ),
                    h('div', { style: S.row, gap: 6 },
                      h('input', {
                        style: S.input,
                        placeholder: TEXT.roomCodePlaceholder,
                        value: roomCode,
                        onChange: (e) => { setRoomCode(e.target.value.toUpperCase()); setFound(null) },
                        onKeyDown: async (e) => {
                          if (e.key !== 'Enter') return
                          e.preventDefault()
                          if (!roomCode.trim()) return
                          const result = await call('/discover', { code: roomCode.trim() })
                          if (result && result.found) setFound(result.room)
                        },
                      }),
                      h('button', {
                        type: 'button',
                        style: S.btn,
                        disabled: busy || !roomCode.trim(),
                        onClick: async () => {
                          const result = await call('/discover', { code: roomCode.trim() })
                          if (result && result.found) setFound(result.room)
                        },
                      }, TEXT.findRoom),
                    ),
                    found
                      ? h('div', { style: S.board },
                          h('div', { style: S.session },
                            h('span', { style: { ...S.dot, width: 6, height: 6, background: 'var(--dsw-alias-state-success-primary, #3fb950)' } }),
                            h('span', { style: { fontWeight: 600 } }, TEXT.roomFound + ' ' + found.code),
                            h('span', { style: S.label }, '房主 ' + (found.host || '-') + ' · ' + (found.members || 0) + ' 人在客厅'),
                          ),
                          h('button', {
                            type: 'button',
                            style: { ...S.btnPrimary, marginTop: 6 },
                            disabled: busy,
                            onClick: async () => {
                              const ok = await call('/join', { code: found.code })
                              if (ok) {
                                setFound(null)
                                setRoomCode('')
                                setExpanded(true)
                              }
                            },
                          }, TEXT.roomJoin),
                        )
                      : null,
                    h('div', { style: { ...S.label, marginTop: 4 } }, TEXT.advanced),
                    h('div', { style: S.label }, TEXT.collabOnlyNote),

                    h('div', { style: { ...S.row, gap: 6 } },
                      h('button', {
                        type: 'button',
                        style: S.btn,
                        disabled: busy,
                        onClick: async () => {
                          const result = await call('/rooms', {})
                          if (result && result.rooms) setRoomList(result.rooms)
                        },
                      }, TEXT.listRooms),
                      roomList ? h('span', { style: S.label }, TEXT.roomsHint) : null,
                    ),
                    roomList
                      ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                          roomList.length === 0
                            ? h('div', { style: S.label }, TEXT.roomsEmpty)
                            : roomList.map((room) =>
                                h('div', { key: room.code, style: S.board },
                                  h('div', { style: S.session },
                                    h('span', { style: { fontFamily: 'ui-monospace,monospace', fontSize: 12, color: 'var(--dsw-alias-brand-primary, #4c8dff)' } }, room.code),
                                    h('span', { style: { ...S.ellipsis, flex: 1, minWidth: 0 } }, (room.host || '-') + ' · ' + (room.members || 0) + ' 人在客厅'),
                                    h('button', {
                                      type: 'button',
                                      style: { ...S.badge, cursor: 'pointer', background: 'transparent' },
                                      disabled: busy,
                                      onClick: async () => {
                                        const joined = sessionMode
                                          ? await call('/session/join', { sessionId: String(props.sessionId || ''), code: room.code })
                                          : await call('/join', { code: room.code })
                                        if (joined) {
                                          setRoomList(null)
                                          setNotice(TEXT.joinedRoom || '已加入')
                                        }
                                      },
                                    }, TEXT.joinThisRoom),
                                  ),
                                ),
                              ),
                        )
                      : null,
                    h('div', { style: S.step }, TEXT.stepCreate),
                    h(
                      'div',
                      { style: S.row },
                      h('input', {
                        style: S.input,
                        placeholder: TEXT.name,
                        value: name,
                        onChange: (e) => setName(e.target.value),
                      }),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        style: S.btnWide,
                        disabled: busy,
                        onClick: async () => {
                          if (sessionMode) {
                            const result = await call('/session/room', { sessionId: String(props.sessionId || '') })
                            if (result) setNotice(TEXT.roomOpened)
                          } else {
                            await call('/create', { name })
                          }
                        },
                      },
                      busy ? TEXT.saving : sessionMode ? TEXT.openForSession : TEXT.create,
                    ),
                    h('div', { style: S.label }, TEXT.createHint),
                    h('div', { style: { ...S.row, marginTop: 2 } },
                      h('button', { type: 'button', style: S.btn, disabled: busy, onClick: () => call('/lab', { members: 2 }) }, TEXT.lab),
                    ),
                    (snap && snap.localSessions && snap.localSessions.length)
                      ? h(
                          'div',
                          null,
                          h('div', { style: { ...S.label, marginBottom: 6 } }, TEXT.myDesk),
                          h(
                            'div',
                            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                            (snap.localSessions || []).slice(0, 4).map((sess) =>
                              h(
                                'div',
                                { key: sess.id, style: S.board },
                                h(
                                  'div',
                                  { style: S.session },
                                  h('span', {
                                    style: {
                                      ...S.dot,
                                      width: 5,
                                      height: 5,
                                      background:
                                        sess.status === 'running'
                                          ? 'var(--dsw-alias-state-success-primary, #3fb950)'
                                          : 'var(--dsw-alias-state-idle-primary, #8b9096)',
                                    },
                                  }),
                                  h('span', { style: { ...S.ellipsis, maxWidth: 140 } }, sess.label || sess.id),
                                  h(
                                    'span',
                                    { style: { ...S.ellipsis, flex: 1, minWidth: 0 } },
                                    (sess.status === 'running' ? TEXT.running : TEXT.idle) +
                                      (sess.tool ? ' · ' + sess.tool : '') +
                                      (sess.note ? ' · ' + sess.note : ''),
                                  ),
                                  h('span', { style: { flex: '0 0 auto' } }, fmtTokens((sess.tokensIn || 0) + (sess.tokensOut || 0)) + ' ' + TEXT.tokens),
                                ),
                                (sess.timeline || []).slice(-1).map((t) =>
                                  h(
                                    'div',
                                    { key: t.id, style: S.trailRow },
                                    h('span', { style: S.trailKind }, t.kind === 'say' ? '说' : t.kind === 'ask' ? '问' : '做'),
                                    h('span', { style: { ...S.ellipsis, flex: 1, minWidth: 0 } }, (t.tool ? t.tool + ' ' : '') + (t.text || '')),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        )
                      : null,
                    h('div', { style: { ...S.label, marginTop: 4 } }, TEXT.joinTitle),
                    h('div', { style: S.label }, TEXT.joinHint),
                    h(
                      'div',
                      { style: S.row },
                      h('input', {
                        style: S.input,
                        placeholder: TEXT.paste,
                        value: paste,
                        onChange: (e) => setPaste(e.target.value),
                        onKeyDown: (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            doPaste()
                          }
                        },
                      }),
                      h('button', { type: 'button', style: S.btn, disabled: !paste.trim(), onClick: doPaste }, '识别'),
                    ),
                    h(
                      'div',
                      { style: S.row },
                      h('input', {
                        style: S.input,
                        placeholder: TEXT.relay,
                        value: relay,
                        onChange: (e) => setRelay(e.target.value),
                      }),
                      h('input', {
                        style: { ...S.input, flex: '0 0 104px' },
                        placeholder: TEXT.code,
                        value: code,
                        onChange: (e) => setCode(e.target.value.toUpperCase()),
                      }),
                      h('button', {
                        type: 'button',
                        style: S.btn,
                        disabled: busy,
                        onClick: async () => {
                          if (sessionMode) {
                            const code = (codeInput || '').trim().toUpperCase()
                            if (!code) {
                              setError('需要房间号')
                              return
                            }
                            const result = await call('/session/join', { sessionId: String(props.sessionId || ''), code })
                            if (result) setNotice(TEXT.joinedRoom)
                          } else {
                            await doJoin()
                          }
                        },
                      }, TEXT.join),
                    ),
                    notice ? h('div', { style: S.label }, notice) : null,
                  )
                : h(
                    React.Fragment,
                    null,

                    h('div', { style: S.row, gap: 8 },
                      h('span', { style: S.step }, TEXT.livingRoom),
                      h('button', {
                        type: 'button',
                        style: { ...S.badge, cursor: 'pointer', background: 'transparent' },
                        disabled: busy,
                        title: TEXT.shareTranscriptToggle,
                        onClick: async () => {
                          const next = !shareOut
                          setShareOut(next)
                          await call('/settings', { shareTranscript: next })
                        },
                      }, (shareOut ? '✔ ' : '✕ ') + TEXT.shareTranscriptToggle),
                    ),
                    h('div', { style: shareOut ? S.warn : S.label }, shareOut ? TEXT.shareTranscriptOn : TEXT.shareTranscriptOff),
                    h(
                      'div',
                      { style: { ...S.row, justifyContent: 'space-between' } },
                      h(
                        'div',
                        { style: { ...S.row, gap: 10, alignItems: 'baseline' } },
                        h('span', { style: S.label }, TEXT.invite),
                        h('span', { style: S.code }, (effective && effective.code) || '------'),
                        h('span', { style: S.badge }, mode === 'host' ? '房主' : '成员'),
                      ),
                      h(
                        'div',
                        { style: S.row },
                        mode === 'host'
                          ? h(
                              'div',
                              { style: { ...S.row, gap: 8 } },
                              h('span', { style: { ...S.label, color: 'var(--dsw-alias-label-secondary, #9aa0a6)' } },
                                TEXT.projectLabel + '：' + ((effective && effective.project && effective.project.name) || (sessionMode ? '这个会话' : '未命名'))),
                              (snap && snap.project && snap.project.cwd)
                                ? h('span', { style: { ...S.label, ...S.ellipsis, maxWidth: 260 } }, snap.project.cwd)
                                : null,
                            )
                          : null,
                        mode === 'host' && !(effective && effective.sessionMode)
                          ? h(
                              'div',
                              { style: { ...S.row, gap: 6 } },
                              h('input', {
                                style: S.input,
                                placeholder: TEXT.publicPlaceholder,
                                value: publicBase,
                                onChange: (e) => setPublicBase(e.target.value),
                              }),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  style: S.btn,
                                  disabled: busy || !publicBase.trim(),
                                  onClick: async () => {
                                    const saved = await call('/settings', { publicBaseUrl: publicBase.trim() })
                                    if (saved) setNotice(TEXT.publicSaved)
                                  },
                                },
                                TEXT.publicSave,
                              ),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  style: S.btn,
                                  disabled: busy,
                                  onClick: async () => {
                                    const result = await call('/public-url/check', { publicBaseUrl: publicBase.trim() })
                                    setNotice(result && result.ok ? TEXT.publicOk : TEXT.publicBad)
                                  },
                                },
                                TEXT.publicCheck,
                              ),
                            )
                          : null,
                        mode === 'host' && !(effective && effective.sessionMode)
                          ? h(
                              'div',
                              { style: { ...S.row, gap: 8 } },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  style: tunnelInfo && tunnelInfo.running ? S.btn : S.btnPrimary,
                                  disabled: busy || (tunnelInfo && tunnelInfo.starting),
                                  onClick: () => call(tunnelInfo && tunnelInfo.running ? '/tunnel/stop' : '/tunnel/start'),
                                },
                                tunnelInfo && tunnelInfo.running ? TEXT.tunnelStop : TEXT.tunnelOnLabel,
                              ),
                              tunnelInfo && tunnelInfo.starting
                                ? h('span', { style: S.label }, TEXT.tunnelStarting)
                                : tunnelInfo && tunnelInfo.running
                                  ? h('span', { style: { ...S.label, wordBreak: 'break-all' } }, tunnelInfo.url)
                                  : h('span', { style: S.label }, tunnelInfo && tunnelInfo.error ? TEXT.tunnelError + tunnelInfo.error : TEXT.tunnelIdle),
                            )
                          : null,
                        mode === 'host' && invite
                          ? h('button', { type: 'button', style: S.btn, onClick: () => copy(invite.primaryUrl, 'invite') }, copied === 'invite' ? TEXT.copied : TEXT.copy)
                          : null,
                        h('button', {
                          type: 'button',
                          style: S.btn,
                          disabled: busy,
                          onClick: async () => {
                            if (sessionMode) {
                              await call('/session/leave', { sessionId: String(props.sessionId || '') })
                            } else {
                              await call('/leave')
                            }
                          },
                        }, TEXT.leave),
                      ),
                    ),

                    active && currentSessionId
                      ? h(
                          'div',
                          { style: S.row, gap: 8 },
                          h('div', { style: sessionMode || isShared !== false ? S.label : S.warn },
                            sessionMode
                              ? TEXT.sessionRoomBound
                              : isShared === false
                                ? TEXT.notSharedHint
                                : TEXT.sharedHint),
                          h('button', {
                            type: 'button',
                            style: { ...S.badge, cursor: 'pointer', background: 'transparent' },
                            onClick: () => {
                              const ok = props && typeof props.startCollab === 'function' ? props.startCollab() : false
                              if (!ok) setError(TEXT.newCollabFail)
                            },
                          }, TEXT.newCollabSession),
                        )
                      : null,
                    invite ? h('div', { style: S.step }, TEXT.inviteStep) : null,
                    invite
                      ? h(
                          'div',
                          { style: S.inviteBox },
                          h(QrCode, { qr: invite.qr, size: 132 }),
                          h(
                            'div',
                            { style: { flex: '1 1 200px', minWidth: 180, display: 'flex', flexDirection: 'column', gap: 6 } },
                            h('div', { style: S.label }, TEXT.scanHint),
                            h(
                              'div',
                              { style: S.linkLine, title: invite.primaryUrl },
                              h('span', { style: S.linkText }, invite.primaryUrl),
                              h('button', { type: 'button', style: { ...S.linkBtn, marginLeft: 0 }, onClick: () => copy(invite.primaryUrl, 'link') }, copied === 'link' ? TEXT.copied : '复制'),
                            ),
                            h(
                              'div',
                              { style: S.row },
                              h('button', { type: 'button', style: S.btn, onClick: () => copy(invite.primaryUrl, 'link') }, copied === 'link' ? TEXT.copied : TEXT.copyLink),
                              h('button', { type: 'button', style: S.btn, onClick: () => copy(invite.plain, 'plain') }, copied === 'plain' ? TEXT.copied : '复制 relay+码'),
                            ),
                            h('div', { style: S.label, wordBreak: 'break-all' }, TEXT.relayLabel + '：' + invite.lanRelay),
                            h(
                              'div',
                              { style: S.warn },
                              (effective && effective.sessionMode) ? null : invite.loopbackOnly
                                ? TEXT.loopbackBlocked
                                : invite.channel === 'tunnel'
                                  ? TEXT.tunnelHint
                                  : invite.reachable
                                    ? TEXT.lanHint
                                    : TEXT.loopbackWarning,
                            ),
                          ),
                        )
                      : h(
                          'div',
                          { style: { ...S.label, wordBreak: 'break-all' } },
                          TEXT.relayLabel + '：' + ((invite && invite.relay) || (effective && effective.relay) || relay || '（未配置）'),
                        ),
                    invite && invite.channel === 'relay'
                      ? h('div', { style: S.label }, TEXT.relayInviteHint)
                      : null,
                    mode === 'host' && !(effective && effective.sessionMode)
                      ? h(
                          'div',
                          { style: S.row },
                          h(
                            'button',
                            {
                              type: 'button',
                              style: S.btn,
                              disabled: busy,
                              onClick: () => call(lab.running ? '/lab/stop' : '/lab', lab.running ? {} : { members: 2 }),
                            },
                            lab.running ? TEXT.labStop : TEXT.lab,
                          ),
                          lab.running ? h('span', { style: S.label }, TEXT.labOn + '：' + (lab.members || []).join(' / ')) : null,
                          h('span', { style: { ...S.label, marginLeft: 'auto' } }, TEXT.roomTotal + ' ' + fmtTokens(roomTokens) + ' ' + TEXT.tokens),
                        )
                      : null,
                    h(
                      'div',
                      { style: S.row },
                      h('input', {
                        style: S.input,
                        placeholder: TEXT.sharePlaceholder,
                        value: sharePath,
                        onChange: (e) => setSharePath(e.target.value),
                      }),
                      h(
                        'button',
                        {
                          type: 'button',
                          style: S.btn,
                          disabled: busy || !sharePath.trim(),
                          onClick: async () => {
                            const ok = await call('/share', { path: sharePath.trim() })
                            if (ok) setSharePath('')
                          },
                        },
                        TEXT.share,
                      ),
                    ),
                    h(
                      'div',
                      null,
                      h('div', { style: { ...S.label, marginBottom: 6 } }, TEXT.members + ' (' + members.length + ')'),
                      h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                        members.length === 0
                          ? h('div', { style: S.label }, TEXT.emptyMembers)
                          : members.map((m) =>
                              h(
                                'div',
                                { key: m.id, style: S.member },
                                h(
                                  'div',
                                  { style: { ...S.row, gap: 6 } },
                                  h('span', {
                                    style: {
                                      ...S.dot,
                                      background: m.online
                                        ? 'var(--dsw-alias-state-success-primary, #3fb950)'
                                        : 'var(--dsw-alias-state-idle-primary, #8b9096)',
                                    },
                                  }),
                                  h(
                                    'span',
                                    { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #e8eaed)' } },
                                    m.name || m.id,
                                  ),
                                  m.self ? h('span', { style: S.badge }, '我') : null,
                                  h('span', { style: { ...S.label, marginLeft: 'auto' } }, timeAgo(m.updatedAt)),
                                ),
                                (m.sessions || []).length === 0
                                  ? h('div', { style: S.label }, TEXT.noSession)
                                  : (m.sessions || []).slice(0, 6).map((s) =>
                                      h(
                                        'div',
                                        { key: s.id, style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                                        h(
                                          'div',
                                          { style: S.session },
                                          h('span', {
                                            style: {
                                              ...S.dot,
                                              width: 5,
                                              height: 5,
                                              background:
                                                s.status === 'running'
                                                  ? 'var(--dsw-alias-state-success-primary, #3fb950)'
                                                  : 'var(--dsw-alias-state-idle-primary, #8b9096)',
                                            },
                                          }),
                                          h('span', { style: { ...S.ellipsis, maxWidth: 120 } }, s.label || s.id),
                                          h(
                                            'span',
                                            { style: { ...S.ellipsis, flex: 1, minWidth: 0 } },
                                            (s.status === 'running' ? TEXT.running : TEXT.idle) +
                                              (s.tool ? ' · ' + s.tool : '') +
                                              (s.note ? ' · ' + s.note : ''),
                                          ),
                                          h('span', { style: { flex: '0 0 auto' } }, fmtTokens((s.tokensIn || 0) + (s.tokensOut || 0)) + ' ' + TEXT.tokens),
                                        ),
                                        (s.timeline || []).length
                                          ? h(
                                              'div',
                                              { style: S.trail },
                                              (s.timeline || []).slice(-4).map((t) =>
                                                h(
                                                  'div',
                                                  { key: t.id, style: S.trailRow },
                                                  h('span', { style: S.trailKind }, t.kind === 'say' ? '说' : t.kind === 'ask' ? '问' : '做'),
                                                  h('span', { style: { ...S.ellipsis, flex: 1, minWidth: 0 } },
                                                    (t.tool ? t.tool + ' ' : '') + (t.text || '')),
                                                  h('span', { style: S.trailAt }, timeAgo(t.at)),
                                                ),
                                              ),
                                            )
                                          : null,
                                        (s.artifacts || []).length
                                          ? h(
                                              'div',
                                              { style: S.artifacts },
                                              (s.artifacts || []).slice(0, 4).map((a) =>
                                                h(
                                                  'button',
                                                  {
                                                    key: a.id,
                                                    type: 'button',
                                                    style: S.artifact,
                                                    title: a.path + (a.note ? ' · ' + a.note : ''),
                                                    onClick: () => openArtifact(m, s, a),
                                                  },
                                                  '📄 ' + (a.title || a.id) + (a.bytes ? ' · ' + fmtBytes(a.bytes) : ''),
                                                ),
                                              ),
                                            )
                                          : null,
                                      ),
                                    ),
                              ),
                            ),
                      ),
                    ),
                    preview
                      ? h(
                          'div',
                          { style: S.preview },
                          h(
                            'div',
                            { style: { ...S.row, gap: 6 } },
                            h('span', { style: { fontSize: 11.5, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #e8eaed)' } }, '📄 ' + (preview.title || '成果')),
                            h('span', { style: { ...S.label, ...S.ellipsis, maxWidth: 240 } }, preview.path || ''),
                            preview.truncated ? h('span', { style: S.badge }, '已截断') : null,
                            h('button', { type: 'button', style: { ...S.linkBtn, marginLeft: 'auto' }, onClick: () => setPreview(null) }, '关闭'),
                          ),
                          preview.note ? h('div', { style: S.warn }, preview.note) : null,
                          preview.loading
                            ? h('div', { style: S.label }, '读取中…')
                            : preview.text
                              ? h('pre', { style: S.pre }, preview.text)
                              : h('div', { style: S.label }, '没有正文（可能不是文本文件，或对方只同步了元数据）'),
                        )
                      : null,
                    h(
                      'div',
                      null,
                      h('div', { style: { ...S.label, marginBottom: 6 } }, TEXT.messages),
                      h(
                        'div',
                        { style: S.messages },
                        messages.length === 0
                          ? h('div', { style: S.label }, TEXT.emptyMessages)
                          : messages.map((m) =>
                              h(
                                'div',
                                { key: m.id, style: S.msg },
                                h('span', { style: S.msgMeta }, (m.name || '?') + ' · ' + timeAgo(m.at)),
                                m.text,
                              ),
                            ),
                      ),
                      h(
                        'div',
                        { style: { ...S.row, marginTop: 8 } },
                        h('input', {
                          style: S.input,
                          placeholder: TEXT.placeholder,
                          value: draft,
                          onChange: (e) => setDraft(e.target.value),
                          onKeyDown: (e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              if (draft.trim()) void call('/message', { text: draft }).then((ok) => ok && setDraft(''))
                            }
                          },
                        }),
                        h(
                          'button',
                          {
                            type: 'button',
                            style: S.btnPrimary,
                            disabled: busy || !draft.trim(),
                            onClick: async () => {
                              const ok = await call('/message', { text: draft })
                              if (ok) setDraft('')
                            },
                          },
                          TEXT.send,
                        ),
                      ),
                    ),
                  ),
              error ? h('div', { style: S.error }, error) : null,
            )
          : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const startCollab = () => {
          try {
            const service = (ctx.get && ctx.get('uiWorkspace')) || ctx.uiWorkspace
            if (!service || typeof service.startSession !== 'function') return false
            service.startSession(undefined, { agentPreset: 'collab' })
            return true
          } catch {
            return false
          }
        }
        const PanelWithActions = (props) => h(CollabPanel, { ...props, startCollab })
        const dispose = ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register({ name: 'conversation.composer.dock', id: 'dsh-collab', order: 20 }, PanelWithActions),
        )
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      },
    }
  },
})
